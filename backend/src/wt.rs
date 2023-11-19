//! This file contains implementations related to WebTransport
use bytes::{BufMut, Bytes, BytesMut};
use h3::{
    ext::Protocol,
    quic::{RecvDatagramExt, SendDatagramExt},
    server::Connection,
};
use h3_webtransport::server::WebTransportSession;
use hyper::Method;
use lazy_static::lazy_static;
use tracing::info;

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
                        info!(?req, "Request Recived");
                    }
                }
            }

            //We need to handle the None variant
            //imdicating no more data to be received
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
                    // Put something before to make sure encoding and
                    // decoding works and don't just pass through
                    let mut resp = BytesMut::from(&b"Response: "[..]);
                    resp.put(datagram);

                    session.send_datagram(resp.freeze())?;
                    info!("Finished sending datagram")
                }
            }
        }
    }
}
