use axum::{
    http::StatusCode,
    response::{Html, Response},
    routing::get,
    Router, Server,
};
use hyper::{header, Body};
use std::{net::SocketAddr, path::Path, process::Stdio};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

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

#[tokio::main]
async fn main() {
    let env = env::load();

    let app = Router::new()
        .route("/media/*file_path", get(serve_media_file))
        .route("/ingest", get(ingest));

    let addr = SocketAddr::from(([127, 0, 0, 1], env.port));
    println!("server started at addr: http://{:?}", addr);

    Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .expect("Failed to start server");
}

// majiix is a web-based video streaming service.
// Technologies:

// Webcodecs -> for video and audio encoding and decoding
// WebTransport -> for transmitting the video and audio over a network
