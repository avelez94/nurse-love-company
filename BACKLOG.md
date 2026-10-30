# To do

Agreed changes that are not built yet, newest first.

## Account email change
Today the account email cannot be changed on the site ("contact support"). Planned:

* **Admin change:** in Admin, Customers, a person's page gets **Change email** (new address and a reason). Recorded in the audit log; that person's sessions are signed out so they sign in again with the new email. Works without email sending.
* **Self-service change:** on My account, the person enters the new email and their current password. A confirmation link goes to the **new** address and the change happens only when it is clicked; the old address gets a notice. Needs Resend connected; until then the page says it will be available once email is set up.

Until then, an email can be corrected directly in the Supabase database on request, recorded in the audit log.

## Waiting for the owner's content
Built and ready, nothing published:
* **Nurse Kin button** (Marketing, Nurse Kin): the real address, approved description, labels, optional logo.
* **Resource quiz** (Marketing, Resource Quiz): questions, answers, result groups and their products.
* **Our Story** (Content, Our Story): her own words and a portrait.
* **Product previews**: selected sample page images, what's included lists, optional walkthrough tutorials.

## Not built
* **Generating previews from the PDF automatically.** Previews are uploaded by hand for now (screenshots or exports), which keeps the owner in control of exactly which pages are shown.

## Also open
* **Show password button on Sign in and Reset password** (sign up already has it). Offered, not yet requested.
* **Large downloads on Vercel:** confirm a product file over 5 MB downloads completely (see DEPLOYMENT.md, "The strict download rule on Vercel"). If it is cut short, plan chunked delivery; never a reusable storage link.
* **Before launch:** move the Supabase organization to the paid plan (free projects pause after about a week without activity), connect Stripe in test mode, connect Resend with a verified sending domain, add policies and contact details.
