use clap::Parser;
use rustls::{Certificate, PrivateKey};
use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use tracing::{error, info, level_filters::LevelFilter, trace_span};
use tracing_subscriber::EnvFilter;
use wt::WEBTRANSPORT_ALPN;

mod env;
mod wt;

#[derive(Debug, Parser)]
#[clap(name = "wt_server")]
pub struct Args {
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_logging();

    let _env = env::load();

    let args = Args::parse();

    let Certs { cert, key } = args.certs;

    //DER-encoded cert and key
    let cert = Certificate(std::fs::read(cert)?);
    let key = PrivateKey(std::fs::read(key)?);

    let mut tls_config = rustls::ServerConfig::builder()
        .with_safe_default_cipher_suites()
        .with_safe_default_kx_groups()
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)?;

    tls_config.max_early_data_size = u32::MAX;
    tls_config.alpn_protocols = WEBTRANSPORT_ALPN.to_vec();

    let mut server_config = quinn::ServerConfig::with_crypto(Arc::new(tls_config));
    let mut transport_config = quinn::TransportConfig::default();
    transport_config.keep_alive_interval(Some(Duration::from_secs(3)));
    server_config.transport = Arc::new(transport_config);
    let endpoint = quinn::Endpoint::server(server_config, args.listen)?;

    info!("listening on {}", args.listen);

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
                        if let Err(err) = wt::handle_connection(h3_conn).await {
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

    // shut down gracefully
    // wait for connections to be closed before exiting
    endpoint.wait_idle().await;

    Ok(())
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
