ALTER TABLE "users"
  ADD CONSTRAINT "users_identity_iv_length_check"
    CHECK (octet_length("identity_iv") IN (0, 12)),
  ADD CONSTRAINT "users_identity_auth_tag_length_check"
    CHECK (octet_length("identity_auth_tag") IN (0, 16)),
  ADD CONSTRAINT "users_dek_iv_length_check"
    CHECK (octet_length("dek_iv") IN (0, 12)),
  ADD CONSTRAINT "users_dek_auth_tag_length_check"
    CHECK (octet_length("dek_auth_tag") IN (0, 16)),
  ADD CONSTRAINT "users_encrypted_dek_length_check"
    CHECK (octet_length("encrypted_dek") IN (0, 32)),
  ADD CONSTRAINT "users_email_lookup_hmac_length_check"
    CHECK ("email_lookup_hmac" IS NULL OR octet_length("email_lookup_hmac") = 32);
