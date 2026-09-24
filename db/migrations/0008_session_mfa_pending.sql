-- Pending TOTP secret during enrolment (encrypted with APP_MASTER_KEY), cleared once the first code verifies.
alter table sessions add column mfa_pending_enc text;
