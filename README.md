# Majiix

Majiix is a web-based open-source streaming service. The backend that handles the core streaming logic is written in Rust and makes use of cutting-edge tech like the [WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport) and the [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) APIs.

## Development

We use a yarn monorepo, leveraging the dependency management and package.json scripts across languages.

| Script name | Expected functionality | Runs in CI |
| ----------- | ---------------------- | ---------- |
| build       | Compile for release    |            |
| check       | Typecheck code         | yes        |
| dev         | Run app in dev mode    |            |
| fmt         | Format the source      |            |
| fmt:check   | Check formatting       | yes        |
| lint        | Runs linting           |            |
| lint:fix    | Fix fixable lints      | yes        |
| test        | Ensure tests pass      | yes        |

### Setup Yarn

#### Installation

Expecting you have Node.js LTS already, install yarn:

```sh
corepack enable
corepack prepare yarn@stable --activate
```

#### Shell Aliases

Then, we recommend installing aliases (put this in your shell's runtime config file, e.g. .zshrc or .bashrc):

```sh
alias yrb='yarn workspaces foreach --verbose --parallel --interlaced --recursive --topological-dev run build'
alias yrc='yarn workspaces foreach --verbose --parallel --interlaced --recursive run check'
alias yrd='yarn workspaces foreach --verbose --parallel --interlaced --recursive run dev'
alias yrf='yarn workspaces foreach --verbose --parallel --interlaced --recursive run fmt'
alias yrfc='yarn workspaces foreach --verbose --parallel --interlaced --recursive run fmt:check'
alias yrl='yarn workspaces foreach --verbose --parallel --interlaced --recursive run lint'
alias yrlf='yarn workspaces foreach --verbose --parallel --interlaced --recursive run lint:fix'
alias yrt='yarn workspaces foreach --verbose --parallel --interlaced --recursive run test'
```

#### VS Code

VS Code should simply prompt you to use the bundled TypeScript version when you open the root folder, but in case it doesn't, please see the following link

Follow https://yarnpkg.com/getting-started/editor-sdks#vscode
