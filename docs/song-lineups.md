# Weekly song lineups

Song lineups are tied to one service. The assigned worship leader submits at least two songs; the submission is immediately visible to that service's assigned members. Coordinators can add keys and chords links, confirm the review, or withdraw the lineup. Confirmation does not control visibility.

Song links are checked on submission with a server-side HTTP(S) GET requesting at most the first byte. Redirect targets are checked and pinned to public DNS addresses, and each request has a timeout. The response check confirms only that a public endpoint returned a successful status; it does not inspect the song content or prove that a particular provider's content is playable. Some hosts require cookies, block automated requests, or reject range requests. For those hosts, use a public share URL that allows an unauthenticated request. Chords URLs are syntax-checked as HTTP(S) links but are not fetched.

The migration is additive and is not applied automatically by the application. Apply it through the project's normal reviewed migration process before enabling the feature.
