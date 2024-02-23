use std::net::ToSocketAddrs;

use dotenv::dotenv;
use majiix_backend::webtransport;
use tracing::info;

#[tokio::main]
async fn main() {
    dotenv().ok();
    info!("Starting webtransport server!");

    let opt = webtransport::WebTransportOpt {
        listen: std::env::var("LISTENER_URL")
            .expect("expected LISTENER_URL to be set")
            .to_socket_addrs()
            .expect("expected LISTENER_URL to be a valid socket address")
            .next()
            .expect("expected LISTENER_URL to be a valid socket address"),
        certs: webtransport::Certs {
            cert: std::env::var("CERT_PATH")
                .expect("expected CERT_PATH to be set")
                .into(),
            key: std::env::var("KEY_PATH")
                .expect("expected KEY_PATH to be set")
                .into(),
        },
    };

    let _listen = opt.listen;

    let _ = tokio::spawn(async move {
        webtransport::start(opt).await.unwrap();
    })
    .await;
}
