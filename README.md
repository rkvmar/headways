# Headways

Headways is a system that lets you explore transit systems in great detail. It is designed for enthusiasts who want all the nitty gritty information about the local vehicles.

As of now, it only has support for the San Francisco Bay Area and Sacramento, but in the future more systems will be added.

Website built using svelte, server built in go

## Usage
Hosted Build: https://headways.rkmr.dev/

### Building from source:

Clone the repo: 

`git clone https://github.com/rkvmar/headways.git`

Set `PUBLIC_API_BASE_URL` in `.env`:

Use a hosted build: `PUBLIC_API_BASE_URL=https://headwaysapi.rkmr.dev`

Self host: `PUBLIC_API_BASE_URL=localhost:8081` (or wherever your server is hosted)

```
npm run build
npm run preview
```
