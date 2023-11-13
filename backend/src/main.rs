use std::{net::SocketAddr, sync::Arc};
use anyhow::Context;
use tracing::{info, level_filters::LevelFilter};
use tracing_subscriber::EnvFilter;
mod env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_logging();
    let env = env::load();

    let addr = SocketAddr::from(([127, 0, 0, 1], env.port));
    info!("Listening at addr: https://{:?}", addr);
    
    // Generate a cert
    let gen = rcgen::generate_simple_self_signed(vec![addr.to_string()]).unwrap();

    //convert the rcgen cert to a rustls certificate
    let cert = rustls::Certificate(gen.serialize_der().unwrap());
    let key = rustls::PrivateKey(gen.serialize_private_key_der());

    //Quinn setup
    let mut tls_config = rustls::ServerConfig::builder()
        .with_safe_default_cipher_suites()
        .with_safe_default_kx_groups()
        .with_protocol_versions(&[&rustls::version::TLS13]).unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)?;

    tls_config.max_early_data_size = u32::MAX;
    tls_config.alpn_protocols = vec![webtransport_quinn::ALPN.to_vec()];

    let config = quinn::ServerConfig::with_crypto(Arc::new(tls_config));

    info!("Server started at addr: https://{:?}", addr);

    let server = quinn::Endpoint::server(config, addr)?;

    //Accept new connections
    while let Some(conn) = server.accept().await {
        tokio::spawn(async move {
            let _ = handle_webtransport_conn(conn).await;
        });
    }


    Ok(())

}


async fn handle_webtransport_conn(conn: quinn::Connecting) -> anyhow::Result<()> {
    info!("Starting new QUIC connection");

    //wait for QUIC handshake to complete
    let conn = &conn.await.context("failed to accept connection")?;

    //Perform the Webtransport handshake
    let request = webtransport_quinn::accept(conn.clone()).await?;
    info!("received Webtransport request: {}", request.url());

    let session = request.ok().await.context("failed to accept session")?;

    let datagram = session.read_datagram();

    if let Ok(datagram) = datagram.await {
        let q_stream_id = datagram.qstream_id();
        let payload = datagram.payload();

        info!("Received datagram with QStream ID: {:?}", q_stream_id);
        info!("Payload: {:?}", payload);

        session.send_datagram(q_stream_id, payload.clone()).await?;
    }  else {
        // Handle the case where awaiting the datagram fails
        info!("invalid request");
    }

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