# Domain model is in English, with Brazilian terms kept untranslated

The catalogue covers Brazilian music events, where some categories have no faithful English
equivalent — a *baile funk* is not "a party", a *sarau* is not "an open mic". We write the
domain model in English (Event, Venue, Artist, Performance) so it reads idiomatically
alongside English library and framework APIs, but keep Portuguese terms verbatim wherever
translating them would flatten a distinction users actually feel. Mixed-language
identifiers in the domain layer are therefore deliberate, not an oversight.
