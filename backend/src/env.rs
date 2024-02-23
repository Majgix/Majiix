extern crate dotenv;

use std::str::FromStr;

use dotenv::dotenv;

pub struct Env {}

fn _num<F: FromStr>(name: &str, default: F) -> F
where
    <F as FromStr>::Err: std::fmt::Debug,
{
    std::env::var(name)
        .ok()
        .and_then(|x| x.parse().ok())
        .unwrap_or(default)
}

pub fn load() -> Env {
    dotenv().ok();

    Env {}
}
