# Contributing

## Project Overview

This Discord bot manages collaborative round-robin story writing events with the following features:

- **Multi-story support**: Run multiple stories simultaneously on a server
- **User participation**: Users can join multiple stories, defining unique pen name and status for each
- **Turn management**: Writers are chosen in random order, admin can manually define next writer chosen 
- **Flexible timing**: Stories can have custom turn lengths and reminder settings
- **Story modes**: Support for both quick mode and normal mode storytelling
- **Story states**: Stories can be active, paused, or closed
- **Admin controls**: Admins can manage user and story settings
- **Timeout tracking**: System tracks user timeouts and manual passing
- **Entry system**: Writers can submit multiple entries per turn from the private thread that is opened when their turn starts. Media entries are forwarded to a media channel and the post id of the forwarded message is stored. Entries within a turn are kept in order posted.
- **Publishing integration**: Closed stories can be exported to PDF and posted to AO3
- **Job scheduling**: Background job system for reminders and turn timeouts

## Development Guidelines

- Use feature branches and open pull requests against `main`.
- Run `npm test` and `npm run lint` before opening a PR.
- Keep secrets out of the repository; use `config.json` or environment variables.
