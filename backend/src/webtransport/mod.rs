use bytes::Bytes;
use clap::Parser;
use h3::{
    ext::Protocol,
    quic::{RecvDatagramExt, SendDatagramExt},
    server::Connection,
};
use h3_webtransport::server::WebTransportSession;
use hyper::Method;
use lazy_static::lazy_static;
use rustls::{Certificate, PrivateKey};
use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use tracing::{error, info, level_filters::LevelFilter, trace_span};
use tracing_subscriber::EnvFilter;

// list of ALPN values that are supported by the WebTransport protocol
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
#[clap(name = "wt_server")]
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

async fn handle_connection(
    mut conn: Connection<h3_quinn::Connection, Bytes>,
) -> anyhow::Result<()> {
    loop {
        match conn.accept().await {
            Ok(Some((req, stream))) => {
                info!("new request: {:#?}", req);

                let ext = req.extensions();
                match req.method() {
                    &Method::CONNECT if ext.get::<Protocol>() == Some(&Protocol::WEB_TRANSPORT) => {
                        info!("Peer initiating a webtransport session");

                        let session = WebTransportSession::accept(req, stream, conn).await?;

                        handle_session(session).await?;

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

async fn handle_session<C>(session: WebTransportSession<C, Bytes>) -> anyhow::Result<()>
where
    C: 'static
        + Send
        + h3::quic::Connection<Bytes>
        + RecvDatagramExt<Buf = Bytes>
        + SendDatagramExt<Bytes>,
{
    loop {
        tokio::select! {
            datagram = session.accept_datagram() => {
                let datagram = datagram?;
                if let Some((_, datagram)) = datagram {
                    info!("Responding with {datagram:?}");

                    session.send_datagram(datagram)?;
                    info!("Finished sending datagram")
                }
            }
        }
    }
}

fn init_logging() {
    let env_filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .from_env_lossy();

    tracing_subscriber::fmt()
        .with_target(true)
        .with_level(true)
        .with_env_filter(env_filter)
        .init();
}
