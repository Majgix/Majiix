use crate::logger::init_logging;
use bytes::Bytes;
use clap::Parser;
use h3::quic;
use h3::{
    ext::Protocol,
    quic::{RecvDatagramExt, SendDatagramExt, SendStreamUnframed},
    server::Connection,
};
use h3_webtransport::SessionId;
use h3_webtransport::{server::WebTransportSession, stream};
use hyper::Method;
use lazy_static::lazy_static;
use rustls::{Certificate, PrivateKey};
use std::collections::HashMap;
use std::io::{self, Cursor};
use std::time::Instant;
use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use std::{u32, u64, u8, usize, vec};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite};
use tokio::sync::{Mutex, RwLock};
use tracing::{error, info, trace_span};

// List of ALPN values that are supported by the WebTransport protocol
// ALPN -> Application Layer Protocol Negotiaton allows the Application
// layer to negotiate which protocol will be used within the TLS connection
// see https://datatracker.ietf.org/doc/html/rfc9114#name-connection-establishment
lazy_static! {
    pub static ref ALPN: Vec<Vec<u8>> = vec![
        b"h3".to_vec(),
        b"h3-32".to_vec(),
        b"h3-31".to_vec(),
        b"h3-30".to_vec(),
        b"h3-29".to_vec(),
    ];
}

#[derive(Debug, Parser)]
pub struct WebTransportOpt {
    #[clap(
        short,
        long,
        default_value = "127.0.0.1:4443",
        help = "What address:port to listen for new connections"
    )]
    pub listen: SocketAddr,

    #[clap(flatten)]
    pub certs: Certs,
}

#[derive(Debug, Parser)]
pub struct Certs {
    #[clap(
        long,
        short,
        default_value = "../certs/localhost.crt.der",
        help = "TLS Certificate. If present, `--key` is mandatory."
    )]
    pub cert: PathBuf,

    #[clap(
        long,
        short,
        default_value = "../certs/localhost.key.der",
        help = "Private key for the certificate."
    )]
    pub key: PathBuf,
}

pub async fn start(opt: WebTransportOpt) -> anyhow::Result<()> {
    init_logging();
    info!("WebTransportOpt: {opt:#?}");

    let opts = WebTransportOpt::parse();

    let Certs { cert, key } = opts.certs;

    //Get the cert and key
    let cert = Certificate(std::fs::read(cert)?);
    let key = PrivateKey(std::fs::read(key)?);

    let mut tls_config = rustls::ServerConfig::builder()
        .with_safe_default_cipher_suites()
        .with_safe_default_kx_groups()
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)?;

    tls_config.max_early_data_size = u32::MAX;
    tls_config.alpn_protocols = ALPN.to_vec();

    let mut server_config = quinn::ServerConfig::with_crypto(Arc::new(tls_config));
    let mut transport_config = quinn::TransportConfig::default();
    transport_config.keep_alive_interval(Some(Duration::from_secs(3)));
    server_config.transport = Arc::new(transport_config);

    let endpoint = quinn::Endpoint::server(server_config, opts.listen)?;

    info!("listening on {}", opts.listen);

    // Accept new quic connections and spawn a new task to handle them
    while let Some(new_conn) = endpoint.accept().await {
        trace_span!("Attempting a new connection");

        tokio::spawn(async move {
            match new_conn.await {
                Ok(conn) => {
                    info!("new HTTP/3 connection established");
                    let h3_conn = h3::server::builder()
                        .enable_webtransport(true)
                        .enable_connect(true)
                        .enable_datagram(true)
                        .max_webtransport_sessions(1)
                        .send_grease(true)
                        .build(h3_quinn::Connection::new(conn))
                        .await
                        .unwrap();

                    tokio::spawn(async move {
                        if let Err(err) = handle_connection(h3_conn).await {
                            error!("Failed to handle connection: {:?}", err);
                        }
                    });
                }
                Err(err) => {
                    error!("Failed to accept connection: {:?}", err);
                }
            }
        });
    }
    Ok(())
}

const CACHE_CLEAN_UP_PERIOD_MS: u32 = 10000;

async fn handle_connection(
    mut conn: Connection<h3_quinn::Connection, Bytes>,
) -> anyhow::Result<()> {
    let mem_files = MemFiles::new(CACHE_CLEAN_UP_PERIOD_MS);
    loop {
        match conn.accept().await {
            Ok(Some((req, stream))) => {
                info!("new request: {:#?}", req);

                let ext = req.extensions();
                match req.method() {
                    &Method::CONNECT if ext.get::<Protocol>() == Some(&Protocol::WEB_TRANSPORT) => {
                        info!("Peer initiating a webtransport session");
                        info!("Established webtransport session");

                        let uri = req.uri().clone();
                        info!("Got uri {:?}", uri);

                        let path = urlencoding::decode(uri.path())?;
                        info!("got path {:?}", path);

                        let session = WebTransportSession::accept(req, stream, conn).await?;

                        let ingest_session_id = session.session_id();

                        handle_ingest_stream(
                            session,
                            ingest_session_id,
                            path.to_string(),
                            uri.query(),
                            mem_files,
                        )
                        .await?;
                        // handle_delivery_stream(session, delivery_session_id, url_path, url_query_string, mem_files);

                        return Ok(());
                    }
                    _ => {
                        info!("Request Received {:?}", req);
                    }
                }
            }

            // We need to handle the None variant
            // indicating no more data to be received
            Ok(None) => {
                break;
            }
            Err(err) => {
                tracing::error!("Error accepting connection: {:?}", err);
                match err.get_error_level() {
                    h3::error::ErrorLevel::ConnectionError => break,
                    h3::error::ErrorLevel::StreamError => continue,
                }
            }
        }
    }

    Ok(())
}

async fn handle_ingest_stream<C>(
    session: WebTransportSession<C, Bytes>,
    ingest_session_id: SessionId,
    url_path: String,
    _url_query_string: Option<&str>,
    mut mem_files: MemFiles,
) -> anyhow::Result<()>
where
    C: 'static
        + Send
        + h3::quic::Connection<Bytes>
        + RecvDatagramExt<Buf = Bytes>
        + SendDatagramExt<Bytes>,
    <C::SendStream as h3::quic::SendStream<Bytes>>::Error:
        'static + std::error::Error + Send + Sync + Into<std::io::Error>,
    <C::RecvStream as h3::quic::RecvStream>::Error:
        'static + std::error::Error + Send + Sync + Into<std::io::Error>,
    stream::BidiStream<C::BidiStream, Bytes>:
        quic::BidiStream<Bytes> + Unpin + AsyncWrite + AsyncRead,
    <stream::BidiStream<C::BidiStream, Bytes> as quic::BidiStream<Bytes>>::SendStream:
        Unpin + AsyncWrite + Send + Sync,
    <stream::BidiStream<C::BidiStream, Bytes> as quic::BidiStream<Bytes>>::RecvStream:
        Unpin + AsyncRead + Send + Sync,
    C::SendStream: Send + Unpin,
    C::RecvStream: Send + Unpin,
    C::BidiStream: Send + Unpin,
    stream::SendStream<C::SendStream, Bytes>: AsyncWrite,
    C::BidiStream: SendStreamUnframed<Bytes>,
    C::SendStream: SendStreamUnframed<Bytes> + Send,
    <C as h3::quic::Connection<Bytes>>::OpenStreams: Send,
    <C as h3::quic::Connection<Bytes>>::BidiStream: Sync,
{
    let session = RwLock::new(session);

    let asset_id = {
        let path_elements: Vec<&str> = url_path.split('/').collect();
        info!("path element: {:?}", path_elements);
        if path_elements.len() >= 3 {
            path_elements[2].to_string()
        } else {
            //None
            format!(
                "{:?} path element should be more than three characters long",
                path_elements
            )
        }
    };

    // Handle incoming uni_directional streams
    tokio::spawn(async move {
        let session = session.read().await;

        while let Ok(uni_stream) = session.accept_uni().await {
            if let Some((_id, mut uni_stream)) = uni_stream {
                let headers_size_bytes = [0u8; 8];
                let file_header = FileHeader::new();

                let header_size = u64::from_be_bytes(headers_size_bytes);
                let header_bytes = vec![0u8; header_size as usize];
                // let file_header = file_header.clone();

                //MediaPackager::decode(&header_bytes, file_header);
                info!("Header decoded");

                let (media_type, is_init) = get_asset_info(&file_header).unwrap();

                let mut f = mem_files
                    .add_new_empty_file(&asset_id, &media_type, is_init, file_header)
                    .await;
                info!(
                    "new file added, asset_id: {}, media_type: {}",
                    asset_id, media_type
                );

                let mut buf = Vec::new();

                let n = uni_stream.read(&mut buf).await;
                let _ = f.write(&n.unwrap().to_ne_bytes());
            }
        }
    });

    Ok(())
}

pub struct MemFiles {
    // use an Arc to enable concurrent access to MemFile instances
    // data_map: HashMap<String, Arc<MemFile>>,
    data_map: HashMap<String, MemFile>,
    // files_lock used to read or write files
    files_lock: Mutex<()>,
}

impl MemFiles {
    pub fn new(house_keeping_period_ms: u32) -> Self {
        let fs = Self {
            data_map: HashMap::new(),
            files_lock: Mutex::new(()),
        };
        return fs;
    }

    pub async fn add_new_empty_file(
        &mut self,
        asset_id: &str,
        media_type: &str,
        is_init: bool,
        headers: FileHeader,
    ) -> MemFile {
        let cache_key = get_cache_key(asset_id, media_type, is_init);
        let new_file = MemFile::new(headers);

        self.files_lock.lock().await;
        let insert_file = self
            .data_map
            .insert(cache_key.to_string(), new_file.into())
            .unwrap();
        //.insert(cache_key.to_string(), (new_file).into());

        insert_file //.clone()
    }
}

pub struct MemFile {
    pub name: String,
    headers: FileHeader,
    pub received_at: Instant,
    buffer: Vec<u8>,
    max_age: u64,
    eof: bool,
    lock: RwLock<()>,
}

impl MemFile {
    pub fn new(headers: FileHeader) -> Self {
        let max_age = get_max_age_from_controller(&headers.cache_control, u64::MAX);
        Self {
            name: String::new(),
            headers,
            received_at: Instant::now(),
            buffer: Vec::new(),
            max_age,
            eof: false,
            lock: RwLock::new(()),
        }
    }

    pub fn write(&mut self, p: &[u8]) -> anyhow::Result<usize, io::Error> {
        let _lock = self.lock.write();
        self.buffer.extend_from_slice(&p);

        Ok(p.len())
    }
}

pub struct FileHeader {
    cache_control: String,
    media_type: String,
    timestamp: Instant,
    chunk_type: String,
}

impl FileHeader {
    pub fn new() -> Self {
        Self {
            media_type: String::new(),
            cache_control: String::new(),
            chunk_type: String::new(),
            timestamp: Instant::now(), //chrono::offset::Utc::now(),
        }
    }
}

pub struct MediaPackager;

impl MediaPackager {
    pub fn decode(header_bytes: &[u8], mut header: FileHeader) -> anyhow::Result<()> {
        let mut buf = Cursor::new(header_bytes);

        let mut data_byte = [0u8; 1];
        let _ = buf.read_exact(&mut data_byte);

        // Decode MediaType
        if (data_byte[0] & 0b11000000) == 0b01000000 {
            header.media_type = "video".to_string();
        } else {
            header.media_type = "audio".to_string();
        }

        // Decode ChunkType
        match data_byte[0] & 0b00110000 {
            0b00010000 => header.chunk_type = "key".to_string(),
            0b00100000 => header.chunk_type = "init".to_string(),
            _ => (),
        }

        Ok(())
    }
}

pub fn get_asset_info(header: &FileHeader) -> anyhow::Result<(String, bool)> {
    let media_type = &header.media_type;
    let is_init = true;

    Ok((media_type.to_string(), is_init))
}

pub fn get_max_age_from_controller(s: &str, default: u64) -> u64 {
    let re = regex::Regex::new(r"max-age=(\d+)").unwrap();
    let captures = re.captures(s);

    if let Some(caps) = captures {
        if let Some(max_age) = caps.get(1) {
            match max_age.as_str().parse::<u64>() {
                Ok(val) => val,
                Err(_) => default,
            };
        }
    }
    default
}

pub fn get_cache_key(asset_id: &str, media_type: &str, is_init: bool) -> String {
    if is_init {
        format!("{}/{media_type}/init", asset_id)
    } else {
        format!(
            "{}/{media_type}/{asset_id}",
            asset_id,
            media_type = media_type,
        )
    }
}
