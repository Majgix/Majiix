use anyhow::Context;
use clap::Parser;
use dotenv::dotenv;
use futures::{stream::FuturesUnordered, StreamExt};
use majiix::{logger::init_logging, room::Room};
use moq_native::{quic, tls};
use std::net;
use tracing::{info, warn};

use moq_dir::{Listings, Session};

#[derive(Clone, Parser)]
pub struct Args {
    #[arg(long, default_value = "[::]:4443")]
    pub bind: net::SocketAddr,

    #[command(flatten)]
    pub tls: tls::Args,

    #[arg(long, default_value = ".")]
    pub namespace: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_logging();
    dotenv().ok();

    let args = Args::parse();
    let tls = args.tls.load()?;

    let quic = quic::Endpoint::new(quic::Config {
        bind: args.bind,
        tls,
    })?;

    let mut server = quic.server.context("missing server certificate")?;

    info!("Listening on: {}", server.local_addr()?);

    let mut tasks = FuturesUnordered::new();

    let listings = Listings::new(args.namespace);
    let room = Room::new();

    loop {
        let room = room.clone();
        tokio::select! {
                res = server.accept() => {
                    info!("Accepting webtransport messages ");
                    let session = res.context("Failed to accept quic connections")?;

                    let session = Session::new(session, listings.clone());
                    tasks.push(async move {
                        if let Err(err) = room.run(session).await {
                            warn!("failed to create room: {}", err);
                        }
                    });
                },
                res = tasks.next(), if !tasks.is_empty() => res.unwrap(),
        }
    }
}
