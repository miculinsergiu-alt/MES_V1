-- Setup wizard state. Existing companies count as set up; new ones start the wizard.
ALTER TABLE companies ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 1;
ALTER TABLE companies ALTER COLUMN onboarding_completed SET DEFAULT 0;
ALTER TABLE companies ADD COLUMN signup_email TEXT;
