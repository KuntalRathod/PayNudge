# Requirements Document

## Introduction

PayNudge is a web application that helps solo freelancers, consultants, and very small agencies (1–5 people) create invoices, track payment status, and automatically chase unpaid invoices with AI-drafted follow-up emails. The product removes the mental overhead of remembering due dates and writing reminder messages, while keeping a human firmly in control of every message that reaches a client.

The core experience targets two speed goals: getting from "just finished a project" to "invoice sent" in under a minute, and getting from "client ghosting on payment" to "follow-up sent" in a single approval click. An AI agent evaluates how overdue each invoice is and drafts a follow-up email with an appropriately escalating tone, but never sends on its own — every message is reviewed, optionally edited, and approved by the user before delivery.

This document specifies the functional requirements for authentication, client management, invoice creation and sending, the dashboard, payment tracking, overdue detection, AI follow-up drafting, human-in-the-loop approval, the escalation cycle, and history tracking.

The AI follow-up drafting is powered by Google Gemini (Gemini 2.5 Flash model) rather than a paid provider. Gemini's free tier allows 1,500 requests per day with no credit card required while delivering frontier-level quality, which comfortably covers the follow-up drafting volume for the target users. It is accessed through the `@google/generative-ai` Node.js SDK and authenticated with the `GOOGLE_API_KEY` environment variable.

## Glossary

- **System**: The PayNudge web application as a whole, including its frontend, backend, database, and AI components.
- **User**: An authenticated account holder (freelancer, consultant, or small agency member) who manages clients and invoices.
- **Auth_Service**: The Supabase-backed component responsible for user sign-up, login, and session management.
- **Client**: A billing contact record owned by a User, consisting of name, email, and optional company.
- **Client_Manager**: The component that creates, stores, and retrieves Client records.
- **Invoice**: A billing record for a specific Client, containing an amount, a description of work, a due date, a sequential invoice number, and a status.
- **Invoice_Manager**: The component that creates, numbers, stores, and updates Invoice records.
- **Invoice_Status**: The state of an Invoice, one of: "draft", "sent", "overdue", or "paid".
- **Email_Service**: The Resend-backed component that delivers invoice emails and approved follow-up emails to Client email addresses.
- **Dashboard**: The home view that summarizes outstanding money, overdue invoices, pending follow-ups, and recent activity.
- **Payment_Tracker**: The component that records when an Invoice is marked paid and updates outstanding totals.
- **Overdue_Detector**: The component that transitions unpaid Invoices to "overdue" status when the current date passes the due date.
- **Follow_Up**: A reminder email associated with an overdue Invoice, drafted by the AI_Agent and requiring User approval before delivery.
- **Follow_Up_Status**: The state of a Follow_Up, one of: "pending_approval", "approved", "sent", or "discarded".
- **AI_Agent**: The LangGraph-plus-Gemini component that evaluates overdue duration and drafts Follow_Up email content, using the Google Gemini 2.5 Flash model via the `@google/generative-ai` Node.js SDK (authenticated with the `GOOGLE_API_KEY` environment variable).
- **Escalation_Tier**: The tone level assigned to a Follow_Up based on days overdue: "polite" (a few days), "firm" (a week or more), or "final_notice" (two weeks or more).
- **Days_Overdue**: The whole number of calendar days between an Invoice due date and the current date, when the current date is later than the due date.
- **Activity_Feed**: A reverse-chronological list of significant events (invoices sent, follow-ups sent, payments received).
- **Follow_Up_History**: The ordered record of all Follow_Ups associated with a single Invoice.
- **Outstanding_Total**: The sum of amounts of all Invoices for a User that are in "sent" or "overdue" status.
- **Chase_Cycle**: The recurring process by which the System drafts escalating Follow_Ups for an unpaid overdue Invoice until it is marked paid.

## Requirements

### Requirement 1: User Authentication

**User Story:** As a freelancer, I want to sign up and log in securely, so that only I can access my clients and invoices.

#### Acceptance Criteria

1. WHEN a visitor submits a sign-up form with an email address in valid email format that is not already registered to an existing User and a password between 8 and 128 characters inclusive, THE Auth_Service SHALL create a new User account and establish an authenticated session.
2. IF a visitor submits a sign-up form with an email address that is not in valid email format, THEN THE Auth_Service SHALL reject the sign-up and return a message indicating the email address format is invalid.
3. IF a visitor submits a sign-up form with a password shorter than 8 characters or longer than 128 characters, THEN THE Auth_Service SHALL reject the sign-up and return a message indicating the password must be between 8 and 128 characters.
4. IF a visitor submits a sign-up form with an email address that already belongs to an existing User, THEN THE Auth_Service SHALL reject the sign-up, leave the existing User account unchanged, and return a message indicating the email address is already registered.
5. WHEN a User submits login credentials whose email address and password both match a stored User account, THE Auth_Service SHALL establish an authenticated session for that User.
6. IF a User submits login credentials whose email address and password do not both match a stored User account, THEN THE Auth_Service SHALL reject the login and return an authentication error message that does not disclose which credential field was incorrect.
7. WHILE a User has no active authenticated session, THE System SHALL restrict access to client, invoice, and dashboard views and redirect the User to the login view.
8. WHEN an authenticated User requests to log out, THE Auth_Service SHALL terminate the User session such that any subsequent request to a client, invoice, or dashboard view is redirected to the login view.
9. THE System SHALL associate every Client and Invoice record with the User that created the record.
10. WHEN an authenticated User requests a list of Client or Invoice records, THE System SHALL return only the records owned by the requesting User.

### Requirement 2: Client Management

**User Story:** As a freelancer, I want to save my clients' details, so that I can reuse them when billing without retyping information.

#### Acceptance Criteria

1. WHEN an authenticated User submits a new client with a name between 1 and 200 characters and an email address, THE Client_Manager SHALL create a Client record owned by that User.
2. WHERE the User provides a company value of at most 200 characters while creating a Client, THE Client_Manager SHALL store the company value with the Client record.
3. IF a User submits a new client without a name or without an email address, THEN THE Client_Manager SHALL reject the submission and return a message identifying the missing required field.
4. IF a User submits a new client with a name that is empty or exceeds 200 characters, or with a company value that exceeds 200 characters, THEN THE Client_Manager SHALL reject the submission and return a message identifying the field that violates its length bound.
5. IF a User submits a new client with an email address that does not conform to a standard email format, THEN THE Client_Manager SHALL reject the submission and return an invalid-email-format message.
6. WHEN an authenticated User requests the client list and owns no Client records, THE Client_Manager SHALL return an empty list.
7. WHEN an authenticated User requests the client list, THE Client_Manager SHALL return all Client records owned by that User.
8. WHEN a User creates an Invoice, THE Client_Manager SHALL allow the User to select an existing Client owned by that User as the Invoice recipient.
9. WHEN an authenticated User submits updated details for an existing Client that the User owns with a name between 1 and 200 characters, an email address conforming to a standard email format, and a company value of at most 200 characters, THE Client_Manager SHALL update the stored Client record with the submitted values.
10. IF a User submits updated details for an existing Client that the User owns with a missing name, a missing email address, a name that is empty or exceeds 200 characters, a company value that exceeds 200 characters, or an email address that does not conform to a standard email format, THEN THE Client_Manager SHALL reject the update, preserve the existing stored Client record unchanged, and return a message identifying the invalid or missing field.
11. IF a User submits updated details for a Client that the User does not own, THEN THE Client_Manager SHALL reject the update, preserve the existing stored Client record unchanged, and return a not-authorized message.

### Requirement 3: Invoice Creation

**User Story:** As a freelancer, I want to create an invoice for a client with the amount, work description, and due date, so that I can bill for completed work quickly.

#### Acceptance Criteria

1. WHEN an authenticated User submits a new invoice specifying an existing Client, an amount between 0.01 and 999,999,999.99 inclusive with a maximum of 2 decimal places, a description of work between 1 and 2000 characters, and a due date that is a valid calendar date, THE Invoice_Manager SHALL create an Invoice record with Invoice_Status set to "draft".
2. WHEN THE Invoice_Manager creates the first Invoice for a User, THE Invoice_Manager SHALL assign the invoice number 1.
3. WHEN THE Invoice_Manager creates a subsequent Invoice for a User, THE Invoice_Manager SHALL assign an invoice number that is one greater than the highest invoice number previously assigned to that User.
4. WHILE two or more invoice submissions for the same User are processed concurrently, THE Invoice_Manager SHALL assign each invoice number uniquely within the scope of that single User.
5. IF a User submits a new invoice with an amount that is zero, negative, non-numeric, greater than 999,999,999.99, or has more than 2 decimal places, THEN THE Invoice_Manager SHALL reject the submission, create no Invoice record, and return an invalid-amount message.
6. IF a User submits a new invoice without a selected Client, without a description of work, with a description that is empty or contains only whitespace, or without a due date, THEN THE Invoice_Manager SHALL reject the submission, create no Invoice record, and return a message identifying the missing required field.
7. IF a User submits a new invoice with a due date that is not a valid calendar date, THEN THE Invoice_Manager SHALL reject the submission, create no Invoice record, and return an invalid-due-date message.
8. WHEN an authenticated User requests an Invoice that the User owns, THE Invoice_Manager SHALL return the Invoice amount, description of work, due date, invoice number, associated Client, and Invoice_Status.
9. IF a User requests an Invoice that does not exist or that the User does not own, THEN THE Invoice_Manager SHALL return a not-available message.

### Requirement 4: Sending Invoices

**User Story:** As a freelancer, I want to send an invoice with a single action, so that my client receives a clean, professional invoice email without extra effort.

#### Acceptance Criteria

1. WHEN an authenticated User who owns an Invoice in "draft" status triggers the send action on that Invoice, THE Email_Service SHALL deliver an invoice email to the email address of the associated Client within 30 seconds.
2. WHEN THE System generates an invoice email, THE System SHALL include the Client name, the invoice number, the amount, the description of work, and the due date in the email content.
3. WHEN THE Email_Service confirms successful delivery of an invoice email within 30 seconds, THE Invoice_Manager SHALL set the Invoice_Status to "sent".
4. IF THE Email_Service returns a delivery error for an invoice email, THEN THE Invoice_Manager SHALL retain the Invoice_Status as "draft" and return a delivery-failure message to the User.
5. IF THE Email_Service does not confirm successful delivery of an invoice email within 30 seconds, THEN THE Invoice_Manager SHALL retain the Invoice_Status as "draft" and return a delivery-failure message to the User.
6. IF a User triggers the send action on an Invoice that is not in "draft" status, THEN THE Invoice_Manager SHALL reject the send action and return a message identifying the current Invoice_Status.
7. IF a User triggers the send action on an Invoice that the User does not own, THEN THE Invoice_Manager SHALL reject the send action, generate and deliver no invoice email, and return a not-authorized message.
8. WHILE a send action for an Invoice is in progress, IF the same User triggers the send action again on that Invoice, THEN THE Invoice_Manager SHALL reject the additional send action so that no more than one invoice email is delivered per send action.
9. WHEN THE Invoice_Status transitions to "sent", THE System SHALL record an invoice-sent event in the Activity_Feed.

### Requirement 5: Dashboard Overview

**User Story:** As a freelancer, I want a home dashboard summarizing my money and pending actions, so that I can understand my payment situation at a glance.

#### Acceptance Criteria

1. WHEN an authenticated User opens the Dashboard, THE Dashboard SHALL display the Outstanding_Total, calculated as the monetary sum of the amounts of all Invoices owned by that User in "sent" or "overdue" status.
2. IF the User owns no Invoices in "sent" or "overdue" status when the Dashboard opens, THEN THE Dashboard SHALL display an Outstanding_Total of 0.
3. WHEN an authenticated User opens the Dashboard, THE Dashboard SHALL display the count of Invoices owned by that User in "overdue" status, displaying 0 when the User owns no Invoices in "overdue" status.
4. WHEN an authenticated User opens the Dashboard, THE Dashboard SHALL display the count of Follow_Ups owned by that User in "pending_approval" status, displaying 0 when the User owns no Follow_Ups in "pending_approval" status.
5. WHEN an authenticated User opens the Dashboard, THE Dashboard SHALL display an Activity_Feed of at most the 20 most recent invoice-sent, follow-up-sent, and payment-received events owned by that User, ordered from most recent to least recent timestamp, and for events sharing an identical timestamp SHALL order them by descending event identifier.
6. IF the User owns no invoice-sent, follow-up-sent, or payment-received events when the Dashboard opens, THEN THE Dashboard SHALL display an empty Activity_Feed.
7. WHEN a User marks an Invoice as "paid", THE Dashboard SHALL exclude that Invoice amount from the Outstanding_Total on the next Dashboard load.
8. WHEN a User marks an Invoice that was in "overdue" status as "paid", THE Dashboard SHALL exclude that Invoice from the count of Invoices in "overdue" status on the next Dashboard load.

### Requirement 6: Payment Tracking

**User Story:** As a freelancer, I want to mark invoices as paid, so that paid invoices drop off my outstanding list.

#### Acceptance Criteria

1. WHILE the Invoice_Status is "sent" or "overdue", WHEN an authenticated User marks an Invoice that the User owns as paid, THE Payment_Tracker SHALL set the Invoice_Status to "paid" and SHALL display a confirmation message indicating the Invoice has been marked paid.
2. WHEN the Invoice_Status transitions to "paid", THE Payment_Tracker SHALL exclude the Invoice amount from the Outstanding_Total.
3. WHEN the Invoice_Status transitions to "paid", THE System SHALL record a payment-received event in the Activity_Feed.
4. IF a User attempts to mark an Invoice that is already in "paid" status as paid, THEN THE Payment_Tracker SHALL return a message indicating the Invoice is already marked paid and SHALL leave the Invoice_Status unchanged.
5. IF a User attempts to mark an Invoice that the User does not own as paid, THEN THE Payment_Tracker SHALL reject the request, return a message indicating the User is not authorized to modify the Invoice, and SHALL leave the Invoice_Status unchanged.
6. IF a User attempts to mark an Invoice that is in "draft" status as paid, THEN THE Payment_Tracker SHALL reject the request, return a message indicating a draft Invoice cannot be marked paid, and SHALL leave the Invoice_Status unchanged.

### Requirement 7: Overdue Detection

**User Story:** As a freelancer, I want the system to flag invoices that pass their due date, so that I do not have to remember who is late.

#### Acceptance Criteria

1. THE Overdue_Detector SHALL evaluate each Invoice at least once per calendar day.
2. WHEN THE Overdue_Detector evaluates an Invoice in "sent" status and the current calendar date is later than the Invoice due date, THE Overdue_Detector SHALL set the Invoice_Status to "overdue".
3. WHEN THE Overdue_Detector evaluates an Invoice in "sent" status and the current calendar date is equal to or earlier than the Invoice due date, THE Overdue_Detector SHALL leave the Invoice_Status as "sent".
4. WHEN THE Overdue_Detector evaluates an Invoice in "paid" status, THE Overdue_Detector SHALL leave the Invoice_Status as "paid".
5. WHEN THE Overdue_Detector evaluates an Invoice in "draft" status, THE Overdue_Detector SHALL leave the Invoice_Status as "draft".
6. WHEN THE Invoice_Status transitions to "overdue", THE Overdue_Detector SHALL compute Days_Overdue as the whole number of calendar days elapsed since the due date, where the first calendar day after the due date equals 1.
7. WHILE an Invoice is in "overdue" status, THE Overdue_Detector SHALL recompute Days_Overdue on each evaluation as the whole number of calendar days elapsed since the due date, where the first calendar day after the due date equals 1.

### Requirement 8: AI Follow-Up Drafting

**User Story:** As a freelancer, I want an AI agent to draft follow-up emails with an appropriate tone based on how late the invoice is, so that I never have to write reminders or worry about sounding rude.

#### Acceptance Criteria

1. WHEN an Invoice enters "overdue" status and no Follow_Up in "pending_approval" status exists for that Invoice, THE AI_Agent SHALL draft a Follow_Up for that Invoice within 300 seconds of the status transition.
2. WHEN THE AI_Agent drafts a Follow_Up for an Invoice whose Days_Overdue is at least 1 and fewer than 7, THE AI_Agent SHALL assign the Escalation_Tier "polite" to the drafted Follow_Up.
3. WHEN THE AI_Agent drafts a Follow_Up for an Invoice whose Days_Overdue is at least 7 and fewer than 14, THE AI_Agent SHALL assign the Escalation_Tier "firm" to the drafted Follow_Up.
4. WHEN THE AI_Agent drafts a Follow_Up for an Invoice whose Days_Overdue is at least 14, THE AI_Agent SHALL assign the Escalation_Tier "final_notice" to the drafted Follow_Up.
5. WHEN THE AI_Agent drafts a Follow_Up, THE AI_Agent SHALL include the Client name, the invoice amount, the invoice number, and the Days_Overdue value in the drafted email content.
6. WHEN THE AI_Agent completes a Follow_Up draft, THE AI_Agent SHALL set the Follow_Up_Status to "pending_approval".
7. WHEN THE AI_Agent drafts a Follow_Up, THE AI_Agent SHALL generate the email content using the Google Gemini 2.5 Flash model accessed through the `@google/generative-ai` Node.js SDK and authenticated with the `GOOGLE_API_KEY` environment variable.
8. IF THE AI_Agent fails to produce a Follow_Up draft, THEN THE System SHALL record a draft-failure message associated with the Invoice, SHALL NOT create a Follow_Up in "pending_approval" status for that Invoice, and SHALL leave the Invoice eligible for a later draft attempt.
9. IF THE AI_Agent fails to produce a Follow_Up draft for the same Invoice on 3 consecutive attempts, THEN THE System SHALL stop further automatic draft attempts for that Invoice and SHALL record a draft-failure message associated with the Invoice.

### Requirement 9: Human-in-the-Loop Approval

**User Story:** As a freelancer, I want to review, edit, and approve every follow-up before it is sent, so that the AI never emails my clients without my consent.

#### Acceptance Criteria

1. THE System SHALL deliver a Follow_Up email to a Client only after the associated Follow_Up reaches "approved" status through a User action.
2. WHEN an authenticated User requests pending follow-ups, THE System SHALL return all Follow_Ups owned by that User in "pending_approval" status, ordered from most recently drafted to least recently drafted, each including the drafted email content and the associated Invoice number, amount, due date, and Client name.
3. WHEN an authenticated User submits edited content that is non-empty and contains no more than 10,000 characters for a Follow_Up in "pending_approval" status, THE System SHALL replace the drafted email content with the submitted content.
4. IF an authenticated User submits edited content that is empty or exceeds 10,000 characters for a Follow_Up in "pending_approval" status, THEN THE System SHALL reject the edit, retain the existing drafted email content, and return a message identifying the content-length violation.
5. WHEN an authenticated User approves a Follow_Up in "pending_approval" status, THE System SHALL set the Follow_Up_Status to "approved".
6. WHEN THE Follow_Up_Status transitions to "approved", THE Email_Service SHALL deliver the Follow_Up email content to the associated Client email address within 30 seconds.
7. WHEN THE Email_Service confirms successful delivery of a Follow_Up email, THE System SHALL set the Follow_Up_Status to "sent" and SHALL append the Follow_Up to the Follow_Up_History of the associated Invoice with its Escalation_Tier and delivery timestamp.
8. WHEN THE Follow_Up_Status transitions to "sent", THE System SHALL record a follow-up-sent event in the Activity_Feed.
9. IF THE Email_Service does not confirm successful delivery of an approved Follow_Up email within 30 seconds, THEN THE System SHALL retain the Follow_Up_Status as "approved" and return a delivery-failure message to the User.
10. WHEN an authenticated User discards a Follow_Up in "pending_approval" status, THE System SHALL set the Follow_Up_Status to "discarded" and SHALL NOT deliver the Follow_Up email.
11. IF an authenticated User submits an edit, approval, or discard action for a Follow_Up that is not in "pending_approval" status, THEN THE System SHALL reject the action, leave the Follow_Up_Status unchanged, and return a message indicating the Follow_Up is not pending approval.

### Requirement 10: Escalation Cycle

**User Story:** As a freelancer, I want follow-ups to keep escalating automatically until payment arrives, so that persistent non-payers are chased without my ongoing effort.

#### Acceptance Criteria

1. WHEN an Invoice is in "overdue" status and its current Days_Overdue value maps to an Escalation_Tier higher than the Escalation_Tier of the most recent non-discarded Follow_Up for that Invoice, where the Escalation_Tier order from lowest to highest is "polite", then "firm", then "final_notice", THE AI_Agent SHALL draft a new Follow_Up at the Escalation_Tier that maps to the current Days_Overdue value.
2. WHEN an Invoice in the Chase_Cycle transitions to "paid" status, THE System SHALL remove the Invoice from the Chase_Cycle and SHALL stop drafting further Follow_Ups for that Invoice.
3. WHEN an Invoice in the Chase_Cycle transitions to "paid" status, THE System SHALL set any Follow_Up for that Invoice in "pending_approval" status to "discarded".
4. THE System SHALL maintain at most one Follow_Up in "pending_approval" status per Invoice at any time.
5. WHEN THE AI_Agent drafts a new Follow_Up at a higher Escalation_Tier for an Invoice that already has a Follow_Up in "pending_approval" status, THE System SHALL set the existing "pending_approval" Follow_Up to "discarded" before the newly drafted Follow_Up enters "pending_approval" status.

### Requirement 11: History Tracking

**User Story:** As a freelancer, I want a lasting record of every invoice and follow-up per client, so that I can see the full payment history of each relationship.

#### Acceptance Criteria

1. WHEN an authenticated User requests the history for an Invoice that the User owns, THE System SHALL return the Invoice amount, description of work, due date, invoice number, and associated Client, the current Invoice_Status, and the Follow_Up_History for that Invoice.
2. WHEN an authenticated User requests the history for an Invoice that the User owns, THE System SHALL return the Follow_Up_History as a list of each Follow_Up in "sent" status for that Invoice, each with its Escalation_Tier and delivery timestamp, ordered from earliest delivery timestamp to latest, and SHALL return an empty list when no Follow_Up for that Invoice is in "sent" status.
3. WHEN an authenticated User requests the history for a Client that the User owns, THE System SHALL return all Invoices associated with that Client and the current Invoice_Status of each Invoice.
4. THE System SHALL retain every sent Invoice record and every sent Follow_Up record for a User until the User deletes the associated Invoice.
5. IF an authenticated User requests the history for an Invoice that does not exist or that the User does not own, THEN THE System SHALL reject the request, return a message indicating the Invoice is not available, and SHALL NOT return any Invoice details or Follow_Up_History.
6. IF an authenticated User requests the history for a Client that does not exist or that the User does not own, THEN THE System SHALL reject the request, return a message indicating the Client is not available, and SHALL NOT return any Invoice records.
7. WHEN an authenticated User deletes an Invoice that the User owns, THE System SHALL remove that Invoice record and every Follow_Up record associated with that Invoice from retention.
