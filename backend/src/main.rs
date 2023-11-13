use std::net::SocketAddr;

use axum::{response, routing::get, Json, Router, Server};

mod env;

async fn start_stream() -> response::Json<&'static str> {
    Json("Yay!! WebTransport Connection established!")
}

#[tokio::main]
async fn main() {
    let env = env::load();

    let app = Router::new().route("/start-stream", get(start_stream));

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
