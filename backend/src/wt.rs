//! This file contains implementations related to WebTransport
use bytes::Bytes;
use h3::{
    ext::Protocol,
    quic::{RecvDatagramExt, SendDatagramExt},
    server::Connection,
};
use h3_webtransport::server::WebTransportSession;
use hyper::Method;
use lazy_static::lazy_static;
use tracing::info;

// list of ALPN values that are supported by the WebTransport protocol
// The h3 value represents HTTP/3 while the other corresponding
// values represent the quic version
// see https://datatracker.ietf.org/doc/html/rfc9114#name-connection-establishment
lazy_static! {
    pub static ref WEBTRANSPORT_ALPN: Vec<Vec<u8>> = vec![
        b"h3".to_vec(),
        b"h3-32".to_vec(),
        b"h3-31".to_vec(),
        b"h3-30".to_vec(),
        b"h3-29".to_vec(),
    ];
}

pub async fn handle_connection(
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

                        wt_run(session).await?;

                        return Ok(());
                    }
                    _ => {
                        info!(?req, "Request Received");
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

async fn wt_run<C>(session: WebTransportSession<C, Bytes>) -> anyhow::Result<()>
where
    C: 
        'static
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
