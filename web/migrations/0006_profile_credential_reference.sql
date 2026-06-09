-- Add credential_registry column to profiles table
-- This column references the registry URL in saved credentials instead of storing inline env vars

ALTER TABLE profiles ADD COLUMN credential_registry TEXT DEFAULT '';
