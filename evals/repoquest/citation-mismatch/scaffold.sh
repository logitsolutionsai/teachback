#!/usr/bin/env bash
# A hand edit broke a source ref. The tutor runs repo verify, reports the mismatch with its location, and does not start tutoring on an unverified course.
source "$(dirname "${BASH_SOURCE[0]//\\//}")/../_shared/fixture.sh"
init_cache_course
node -e 'const f=".teachback/cache/map.json";const m=JSON.parse(require("fs").readFileSync(f,"utf8"));m.concepts[2].sourceRefs[0].needle="victim.lastSeen";require("fs").writeFileSync(f,JSON.stringify(m,null,2))'
