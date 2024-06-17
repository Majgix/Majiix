use futures::{stream::FuturesUnordered, StreamExt};
use moq_dir::Listings;

// Listings has a State struct that manages a TrackWriter handle
// and a reader with TrackReader handle
//
// so the idea is that you subscribe to the listing of announcements to learn about other participants
// ex. each participant does ANNOUNCE .rooms.12345.alice and then
// SUBSCRIBE .rooms.12345. to receive a live updating list of other participants
// and I think you can just independently initialize a Player for each one
// the room update track just consists of deltas like +alice or -bob
// you still need to fetch the catalog for each participant

#[derive(Clone)]
pub struct Room {}

impl Room {
    pub fn new() -> Self {
        Self {}
    }

    pub async fn run(self, session: moq_dir::Session) -> anyhow::Result<()> {
        let mut tasks = FuturesUnordered::new();
        tasks.push(async move { session.run().await });

        let _ = tasks.select_next_some().await?;

        Ok(())
    }
}
