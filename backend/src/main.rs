use axum::{
    http::StatusCode,
    response::{Html, Response},
    routing::get,
    Router, Server,
};
use hyper::{header, Body};
use wtransport::{endpoint::IncomingSession, ServerConfig, tls::Certificate, Endpoint};
use std::{net::SocketAddr, path::{Path, PathBuf}, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command, fs::File,
};
use tracing::{info, level_filters::LevelFilter};
use tracing_subscriber::EnvFilter;

mod env;
async fn ingest() -> Result<Html<&'static str>, (StatusCode, &'static str)> {
    // Change these paths as needed
    let input_path = "media/bbb-720p.mp4";
    let output_path = "media/bbb-720p/v.m3u8";

    std::fs::create_dir("media/bbb-720p").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create output folder",
        )
    })?;

    let mut child = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            "pipe:0",
            "-c",
            "copy",
            "-start_number",
            "0",
            "-hls_time",
            "10",
            "-hls_list_size",
            "0",
            "-f",
            "hls",
            output_path,
        ])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to spawn ffmpeg process",
            )
        })?;

    let mut input_file = File::open(input_path).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to open input file",
        )
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        tokio::spawn(async move {
            let mut buffer = [0; 4096]; // Adjust the buffer size as needed
            while let Ok(count) = input_file.read(&mut buffer).await {
                if count == 0 {
                    break; // End of file reached
                }
                if stdin.write_all(&buffer[..count]).await.is_err() {
                    eprintln!("Failed to write to ffmpeg stdin");
                    break;
                }
            }
            stdin.flush().await.expect("Failed to flush ffmpeg stdin");
        });
    }

    // We can handle the child process in whatever way you need here, for example:
    child.wait().await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "error waiting for ffmpeg",
        )
    })?;

    // Respond to the HTTP request to indicate the stream has started
    Ok(Html("ingest completed"))
}

async fn serve_media_file(
    axum::extract::Path(file_path): axum::extract::Path<String>,
) -> Result<Response<Body>, (StatusCode, &'static str)> {
    let base_path = "media"; // Base path to the media directory
    let full_path = format!("{}/{}", base_path, file_path); // Create the full file path
    let mut file = match File::open(full_path).await {
        Ok(file) => file,
        Err(_) => return Err((StatusCode::NOT_FOUND, "File not found")),
    };

    // TODO: stream the file out directly instead of buffering it intermediately in memory
    let mut contents = Vec::new();
    match file.read_to_end(&mut contents).await {
        Ok(_) => (),
        Err(_) => return Err((StatusCode::INTERNAL_SERVER_ERROR, "Failed to read file")),
    };

    let content_type = match Path::new(&file_path)
        .extension()
        .and_then(|ext| ext.to_str())
    {
        Some("m3u8") => "application/x-mpegURL",
        Some("ts") => "video/MP2T",
        _ => "application/octet-stream",
    };

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:3000")
        .body(Body::from(contents))
        .expect("Failed to construct response");

    Ok(response)
}

async fn handle_wt_connection(incoming_session: IncomingSession) -> anyhow::Result<()> {
    info!("Waiting for session request...");

    let session_request = incoming_session.await?;
    info!("Received session request...");

    info!(
        "New session: Authority: '{}', Path: '{}'",
        session_request.authority(),
        session_request.path()
    );

    //accept connection
    let connection = session_request.accept().await?;

    info!("waiting for data from client...");

    loop {
        tokio::select! {
            datagram = connection.receive_datagram() => {
                let datagram = datagram?;
                info!("accepted datagrams");

                let str_data = std::str::from_utf8(&datagram)?;

                info!("received {str_data} from client");

                connection.send_datagram(b"Ack")?;
            }
        }
    }


}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_logging();
    let env = env::load();

    let addr = SocketAddr::from(([127, 0, 0, 1], env.port));
    info!("Listening at addr: https://{:?}", addr);

    let cert_path = PathBuf::from("../certs/localhost.pem");

    let key_path = PathBuf::from("../certs/localhost-key.pem");

    let config = ServerConfig::builder()
        .with_bind_address(addr)
        .with_certificate(Certificate::load(cert_path, key_path).await?)
        .keep_alive_interval(Some(Duration::from_secs(3)))
        .build();

    let server = Endpoint::server(config)?;

    info!("Server ready!");

    let incoming_session = server.accept();

    tokio::spawn(handle_wt_connection(incoming_session.await));



    


    // let app = Router::new()
    //     .route("/media/*file_path", get(serve_media_file))
    //     .route("/ingest", get(ingest));


    // Server::bind(&addr)
    //     .serve(app.into_make_service())
    //     .await
    //     .expect("Failed to start server");

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