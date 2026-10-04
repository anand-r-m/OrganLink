# 09 verification (fixed)

## Why this exists
Section 11 of `docs/context/09_verification_tests.sql` creates a Liver (organ type 3) and offers it to
R5. R5 only has a heart (type 1) waitlist entry, so the offer compatibility trigger rejects the insert
and the whole transaction aborts.

`09_verification_fixed.sql` is a copy with one addition just before section 11: an ACTIVE
type-3 waitlist entry for R5 (urgency `2`). Everything else is identical.

## How to run
On a freshly reset **dedicated local development DB**. The script COMMITs its test rows.

    psql -f tests/09_verification_fixed.sql

(Add connection options such as `-d <dbname>` as needed.)

## The original is untouched
`docs/context/09_verification_tests.sql` is not modified.
