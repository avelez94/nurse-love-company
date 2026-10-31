# Owner guide

Banners, the resource quiz, the Nurse Kin button, reviews, Our Story and product previews. Nothing you create is visible to visitors until you press **Publish**.

After each update is deployed, run the new files in `supabase/updates/` once, in order, in the Supabase SQL Editor (paste the whole file, click Run): `005_quiz_reviews_story_previews.sql`, then `006_email_automations.sql`, then `007_update_notifications.sql`, then `008_freebies_consent.sql`.

# Banners

In the store admin under **Marketing**.

## Banner styles

| Style | Where it appears | Good for |
| --- | --- | --- |
| **Announcement bar** | A slim bar at the very top of the site, on the pages you choose | Sales, shipping notices, new releases |
| **Promotional strip** | Home page, below the big welcome section or above the Freebie Corner | A heading, a sentence and one button |
| **Image and text** | Same places as the strip | A photo beside your words and a button |

Themes: **Blush pink**, **Raspberry pink** (white text), **Warm ivory**, **Soft sage**. All are checked for easy reading.

While an announcement bar is showing, it takes the place of the "Made by a nurse, for nurses." line at the top. That line always stays at the bottom of every page.

## Create a sale banner

1. Marketing, **New banner**.
2. Give it an internal name (only you see it), pick a style, and write the headline, for example "A little nurse love, a little less."
3. Add a button label and where it goes: a page on the site such as `#shop`, `#np-inserts` or `#freebie-corner`, or a full `https://` address.
4. **Coupon code (optional).** A banner never creates a discount by itself.
   * First create the promotion code in **Stripe** (Products, Coupons, then add a promotion code).
   * Type the same code in the banner and press **Check with Stripe**. The banner shows the offer exactly as Stripe defines it, including "on selected items" or a minimum order when those apply.
   * When the code ends or is switched off in Stripe, the banner stops showing on its own.
   * Codes can only be shown once Stripe is connected.
   * Only say "sitewide" if nothing is excluded.
5. Look at the **Computer** and **Phone** previews, then **Save draft**.
6. Press **Publish** when you are happy.

## Schedule it

* **Start** and **End** are in your own timezone, shown on the page. Daylight saving time is handled for you.
* Leave Start empty to begin as soon as you publish; leave End empty to run until you stop it.
* A banner that has not started shows as **Scheduled**; one that is running shows **Showing now**; one past its end shows **Ended**.

## When banners overlap

Each place on the site shows one banner at a time. The **lowest priority number** wins (1 beats 10). If two published banners overlap, the list and the banner page warn you.

## Pause, stop or reuse

* **Pause / Resume**: hide it for now without losing anything.
* **Unpublish**: back to draft.
* **Duplicate**: copy it as a new draft for your next campaign.
* **Archive**: put it away. You can restore it later.
* **Show again to visitors who closed it**: if visitors can close the banner, they will not see it again in that browser until you press this.

## The Nurse Kin button

Marketing, **Nurse Kin**. A small "Meet Nurse Kin" button sits in the bottom right corner of the store. Visitors open it themselves; it never pops up on its own. It stays hidden until you add the real Nurse Kin address and your own description and press Publish.

1. Write the corner button label (for example "Meet Nurse Kin"), the headline, what Nurse Kin is, and the link button label (for example "Visit Nurse Kin"). Add the Nurse Kin address (`https://...`) and, if you like, a logo with a short description of it.
2. Optional: a start and end time. Times are in your own timezone, which the page shows next to the fields.
3. Check the computer and phone previews.
4. **Publish.** Use **Switch off** to hide it for a while without losing anything.

The button is hidden during sign in, password recovery, checkout, customer accounts and the admin, and steps aside while a tutorial video plays or another window is open. It only sends people to Nurse Kin. It does not sign anyone up or collect email addresses.

## Results

Each banner shows **times shown**, **clicks**, **click rate** and **times closed**. For Nurse Kin, "times shown" counts panel openings and a click means someone opened the Nurse Kin website, not that they joined. They are simple totals with no personal information.

# Resource quiz

Marketing, **Resource Quiz**. A "Find my resources" button in the corner of the store (and the "Find your essentials" button on the home page) opens a short quiz that suggests products. It is not a medical assessment, needs no email, and answers are never stored. The corner button is hidden until a quiz is published.

**Floating buttons** (Marketing page, at the bottom). Two switches for the "Find my resources" and Nurse Kin buttons:

* **Show a one time tip**: after about 20 seconds of active browsing, a small speech bubble above the buttons says "Need a little help finding your resources? ♡" or "Have you met Nurse Kin? ♡" (only for buttons that are published). At most once per visit. It never opens a panel by itself; clicking it opens that panel, and it has a close button and fades away after about 12 seconds. It waits while a panel, dialog, the bag or a video is open, while someone is typing, and while page buttons or links sit where it would appear. Closing it or using either button ends tips for that visit.
* **Soft pink glow**: a blush glow around both buttons with one gentle pulse when they first appear. Visitors who prefer reduced motion see no pulse or fade.

Neither appears on sign in, checkout, account, email preference or admin pages.

1. **New quiz**, give it an internal name.
2. **Basics:** the title, a short introduction and the wording of the final button.
3. **Result groups:** each group is a possible result. Give it a title, a short explanation, and choose products and/or collections. Optionally add tutorials or a link to The Freebie Corner. Only published, active products are ever shown; others are marked in the list.
4. **Fallback result:** shown when no group earns points, or when the winning group has nothing available right now.
5. **Questions:** one at a time on the storefront. Choose "Choose one" or "Choose any that apply", required or optional, and helper text. For every answer, type the points it adds to each result group (0 to 10).
6. **How the rules work** explains the scoring in plain words: most points wins; a tie goes to the lower priority number.
7. **Test your quiz:** answer it right on the page; it shows the result and the points. Tests are never counted.
8. **Publish.** The list under "Before it can be published" must be empty first.

Only one quiz is on the storefront. Publishing another moves the current one back to draft. Edits to a published quiz are saved as a draft and visitors keep seeing the published version until you press **Publish changes**. You can also Duplicate, Unpublish, Archive (drafts only) and Restore.

Results: **started**, **finished**, **finish rate** and **product clicks**, for the published version. Totals only; no one's answers are kept.

# Reviews

Customers, **Reviews**. Customers who bought a product (and were not fully refunded) see **Leave a review** next to it in their account: stars, a title, the review, and a public display name. They are reminded not to include patient or private information. One review per customer per product; writing again edits it.

* New and edited reviews wait for you under **Waiting for approval**. Open one with **Review and respond**.
* **Publish** it, or **Reject** it with a reason (spam, abuse, private or patient information, not about the product, or other with a note). Please publish honest criticism too.
* Add an optional public **reply**.
* Shoppers can **report** a published review. It stays visible until you decide: keep it and clear the reports, or unpublish it.
* Filter by status, product and rating. Each review shows its history.

The product page shows the average and count from **published** reviews only, the reviewer's display name, and "Verified purchase". No email, billing name or order number is ever shown. If a purchase is later fully refunded, the review stays but loses "Verified purchase" and can no longer be edited.

# Our Story

Content, **Our Story**. The page is titled "Meet the nurse behind the love" and reads like a little handwritten welcome: your portrait with a strip of gingham tape and a speech bubble, an introduction to the store, three small cards, and a signed closing note. Empty sections are left out.

The editor has four groups:

* **About the founder**: public display name, optional title and credentials, portrait and its description, the speech bubble greeting, and a short introduction. No employers, dates or private details are needed.
* **About the store**: the heading, the store introduction, the three card headings and descriptions, and the shop button label and destination (for example `#shop`).
* **Closing and extras**: the closing message and signature, up to three favorite products (shown only when you turn the section on, and only while they are published and for sale), and Nurse Kin (shown only with your description and the real Nurse Kin address; placeholder addresses such as example.com are never shown and block publishing).
* **Homepage introduction**: the two or three sentences shown with your portrait between "A little extra cute" and The Freebie Corner. Under **More of her story (optional)** are the longer sections (nursing background, why you started, how resources are made, who you hope to support, and an earlier closing message). They are kept even while hidden; the checkbox decides whether they appear under "More of my story".

Fields you have never saved start with suggested wording for you to review. Nothing reaches visitors until you press **Publish**, and what you previewed is exactly what goes live. Required before publishing: your name, a portrait with a short description, the founder introduction, and the home page introduction.

The preview lays the page out at a real desktop, tablet or phone width and scales it to fit, so it matches the public page. Later edits stay in the draft until you publish again; **Unpublish** takes the page back to the general text.

# Terms & Conditions and Privacy Policy

Content, **Policies**. Choose **Terms & Conditions** or **Privacy Policy** at the top. Each starts as a draft written from how this store actually works (accounts, orders, the one download rule, updated files, freebies and the email list, reviews, the quiz, cookies and the services in use). It is a starting point, not legal advice, and publishing does not make it legally approved.

* Replace every [BRACKETED] item with your own details: your business legal name, support email, refund and shipping terms, how customers may use digital files, how long you keep records, governing law, and any minimum age. Nothing like this is filled in for you.
* Each section has a private note (never published) and a **reviewed** checkbox. Editing a section clears its checkbox so changes are always reread.
* **Services: connected now and planned** lists what is actually connected on this site today. Name only services in use when you publish.
* **Publish** is available only when every section is reviewed and no [BRACKETED] text is left. The public page shows "Last updated" with the publish date. Later edits stay in the draft until you publish again; **Unpublish** shows a short "being prepared" note instead.

The footer links to both pages, and the bag links to them before checkout. Text saved earlier under Settings, Policies is kept and becomes the first draft. The website credit in the footer ("Made with love by Alante") is for the website builder only; customers are pointed to Help & contact for the store.

# Product previews ("Peek inside")

Products, open a product, **Sample previews**.

* **Add sample pages** or **Add close up details**: upload PNG, JPG or WebP images of a few selected pages or cropped areas (screenshots or exports). Do not upload the whole resource.
* Each image is reduced to preview size and stamped with "PREVIEW · Nurse Love Company" built into the picture itself. The original upload is discarded.
* Each preview waits for you to press **Approve**. **Hide** takes it down again.
* Approved previews appear behind the **Peek inside** button, with a "Sample" tag, enlarge, previous and next, and a note that only selected pages are shown. With no approved previews, the button is hidden.
* **What's included:** one item per line, shown as a list on the product page.
* **Walkthrough video:** pick a tutorial; the link shows only while that tutorial is published.

Your paid PDF is never used for previews and never shown. Viewing previews does not affect anyone's downloads. Nobody can promise images cannot be copied, so only upload what you are happy to share.

# Email automations

Marketing, **Email Automations**. Three emails, each **off** until you switch it on. Only purchases made while an automation is on are scheduled, so earlier customers are never emailed.

| Email | Sent | Starts from |
|---|---|---|
| Download reminder | 3 days after (you can change it) | the confirmed payment |
| Digital review request | 7 days after | the confirmed payment |
| Physical review request | 14 days after | the **confirmed delivery** of the shipment holding the item |

**Edit the emails:** open **Edit the email** in each section. Plain text with `{{name}}` (first name) and `{{order_number}}`. Product names, pictures, a Leave a review button per product, the one download note and the unsubscribe link are added automatically. **Preview** shows it with sample details; **Send a test** sends the saved email to any address you type, without touching any customer, schedule, review or download.

**Timing:** change the number of days and press **Save delay**. It applies to future purchases. To move emails that are already scheduled, press **Reschedule pending emails** on purpose. Emails go out on the hourly run after they become due. Choose the **store timezone** at the top so dates read the same for everyone.

**Switching off** holds every pending email. Switching back on sends nothing by surprise: you will see the held emails with **Resume held emails** (overdue ones go out on the next run) or **Cancel held emails**.

**Inspect:** the table at the bottom lists every email: scheduled, held, sent, skipped, failed or canceled, with the scheduled date, when it was handed to email, and why it was skipped or held. It links to the customer, order, product and the Email center log. **Cancel** stops a scheduled or held email.

Everything is checked again right before sending. An email is skipped for items already downloaded (reminders), products already reviewed, refunded, canceled or disputed orders, demo orders, customers who turned that email off, and addresses that bounced. Each customer gets at most one review request per product, ever, and at most one reminder per purchased item. Reminders never use, grant or reset a download, and their links only open My downloads or the review form (after signing in if needed).

**Customers** can turn off download reminders and review requests separately in their account, or from the link at the bottom of those emails. Receipts and account emails are not affected.

## Physical items and delivery (Printful)

Shipments and tracking come from Printful automatically (see **Printful** below). Printful reports when it ships, but whether it reports a confirmed **delivery** time depends on Printful's data for that shipment. Shipped is never treated as delivered. When Printful does report a delivery time, the review request is scheduled 14 days after it automatically. When it does not, physical review requests wait as **Held: waiting for a confirmed delivery** until you confirm it:

1. Open the order (Orders, or **Record delivery** in the automations table).
2. Under the shipment, press **Record confirmed delivery**, enter the date and time it was delivered (from the carrier's tracking page) and a reason such as "USPS tracking shows delivered", and save.

This is saved to the audit log; **Correct delivery date** fixes a mistake, also with a reason. Split shipments each get their own delivery date, and each item's review request counts from its own shipment.

If something goes wrong, set the shipment to **delivery problem** and describe it. Review requests for those items are held with that reason until it is delivered. Requests held with no delivery 21 days after shipping are flagged in the table so you can check on them.

# Printful: how physical orders are made and shipped

Printful makes and ships every physical product. You never stock, pack, buy labels or ship anything. There is no stock count for physical items: whether an option can be bought comes from Printful.

**Connect (once).** In Vercel (Settings, Environment Variables, Production) add `PRINTFUL_API_TOKEN` (a private token from the Printful developer portal, limited to your Nurse Love Company store) and `PRINTFUL_WEBHOOK_TOKEN` (32 random characters). If the token can see more than one Printful store, also add `PRINTFUL_STORE_ID`. Redeploy. Never paste the token into chat or email.

**Billing (once, in Printful).** Printful charges your Printful billing method (card, PayPal or Printful Wallet) for production and shipping when an order is confirmed. That is separate from what the customer pays you through Stripe. Set it up in Printful (Settings, Billing) before confirming orders. If a charge fails, Printful does not make the order and it shows here as needing attention.

**Link each product.** Open the product, **Printful** panel: choose the product in your Printful store, then pick the exact Printful variant for each option and **Save links**. For a new product with no options yet, **Create options from these Printful variants** makes one option per Printful variant and links each. Nothing is matched automatically. Options that are not linked, or that Printful cannot make right now (discontinued, out of stock, ignored, or without an approved print file), cannot be bought and show as unavailable. **Check availability** asks Printful again; it is also checked every hour and before every shipping quote.

**Printful page (sidebar).** Shows the connection, **Run checks** (read only: it connects, reads products and links, and with a sample address gets a real shipping quote and a cost estimate; nothing is created or charged), and **Point Printful webhooks here** (Printful has one webhook address per store, so you are asked before replacing another). Two switches:

* **Open sales of items that ship**: off until you turn it on. While off, customers can still buy digital items, and items that ship explain they are not available yet.
* **Confirm paid orders for production automatically**: when on, each paid order is confirmed with Printful right away (and Printful charges you). When off, each paid order waits in Printful as a draft and you confirm it from the order.

**What the customer sees.** In the bag, items that ship ask for the delivery address first; Printful quotes the real shipping options for those exact items and that address, and the customer picks one before paying. Stripe charges exactly that shipping price. Digital items never add shipping.

**After payment.** The order goes to Printful automatically with the exact variants, approved designs, quantities, address and chosen shipping. Digital downloads are ready at once, whatever happens at Printful. On the order, the **Printful** panel shows Printful's own status and what Printful charges you. Shipments, partial shipments and tracking appear on the order and in the customer's account automatically, and the customer gets one shipping email per package.

**When an order needs attention** (Printful refused it, a charge failed, it was put on hold, or Printful did not answer clearly), the admins get an email and the order shows the reason. Nothing is ever marked as shipped without Printful's shipment. On the order:

* **Check with Printful** reads the latest status (safe any time).
* **Check and continue sending** looks the order up in Printful first and only sends it if Printful does not have it, so it can never create a second Printful order.
* **Confirm for production** confirms a draft or a failed order after you fix billing (Printful charges you).
* **Cancel at Printful** works only before production starts (draft or pending). It does **not** refund the customer. Refunding (with **Refund**) does **not** cancel at Printful either. Do both if both are needed.

# Updating a digital product's file

Products, open the product, **Downloadable file**.

1. **Choose a replacement file.** It uploads privately; nothing changes for customers yet.
2. Optional: write **What changed**. It appears in the email and on My downloads. You can leave it empty.
3. Press **Save changes**. That is all: there is no separate publish or send button.

When you save an existing **published** product with a new file:

* it becomes the latest version;
* every eligible buyer has one download of it (an unused older download is replaced, never added to; buyers who never downloaded still have exactly one download, now of the latest version);
* customers who downloaded an older version get one email, "An updated version of [product] is ready 💕", with a My downloads button. Customers who never downloaded are not emailed.

Nothing is released if you only upload without saving, if the save fails, if the product is a draft (the file waits until you publish and save again), or if the file is identical to the current one (checked by its content, not its name). Refunds, revocations and other purchase rules still apply. If you save a newer file before the earlier emails went out, customers get one email about the newest version.

After saving, a green box shows what happened, and the version table shows each update's downloads and emails: queued, sent, skipped (for example, the customer already downloaded the new version), held (email sending not connected) or failed. **Show customers** lists them with links to the email log. **Retry notifications** sends held or failed ones again once Resend is connected. Email problems never undo an update or remove anyone's download.

# Help & FAQs

Content, **Help & FAQs**. The Help page is a searchable FAQ with four categories. All 28 starter answers are **drafts**: visitors see nothing until you approve answers and publish.

1. Open a question, check the answer against how the store really works, and edit it. Replace anything in [BRACKETS] (for example [SUPPORT EMAIL]); an answer with brackets cannot be approved.
2. Tick **Approved: I checked this answer and it can be published**.
3. Press **Publish** (or **Publish changes**). Only approved answers appear; empty categories are hidden.

Edits to published answers stay drafts until you publish again. To take one answer down, untick Approved and publish. **Unpublish** hides all answers (the contact card stays).

You can rename and reorder categories, add, reorder, delete and move questions (Category menu), and add search keywords such as "coupon, promo". Links: `[My Downloads](#account-downloads)` for a page on this site, `[label](https://...)` for another site, and `[Find my resources](#find-my-resources)` to open the quiz. A paragraph that starts with `{{if quiz}}` only shows while a quiz is published (`{{if tutorials}}` for tutorials). Owner notes are only shown in the admin.

The contact card shows the email, support hours, timezone and response time once they are filled in without brackets, plus "Message us from your account". The preview shows the computer and phone layout of what will be published.

# Freebies and the email list

**Make a freebie:** Products, open a digital product, tick **Include in Freebie Corner** (under Price) and save. The price becomes $0 and, once published, it shows in the Freebie Corner. The file stays private and is delivered in the customer's account with one download. To take it out of the Freebie Corner, untick the box and enter the selling price you want; the old price never comes back by itself. Draft, active and publish controls work as usual.

**How customers claim it:** they add it to the bag and check out with their account email. The condition is shown on the Freebie Corner, on the product page and again in the bag:

> Join our email list to receive this free resource, plus Nurse Love Company news, new resources, and offers. You can unsubscribe at any time.

The box starts unticked and can always be unticked. Without it, the bag explains why and offers to remove the freebie (paid items can still be bought without joining). An all free bag needs no payment or card details and completes right away as a $0 order. Customers already on the list just claim it; customers who unsubscribed before must tick the box again. A customer can claim each freebie once.

**What is recorded:** Marketing, **Email list** shows everyone who joined or unsubscribed, how (freebie checkout, checkout, account settings), when, and the exact wording they agreed to (History). Records cannot be edited. Unsubscribing never removes a freebie or stops receipts, download emails or account emails.

**Mailing list:** nothing is connected yet: Resend is not set up on the live site at all, so no email of any kind is sent yet, and there is no mailing list. Signups are stored and wait ("Waiting: no list connected"). Order emails need `RESEND_API_KEY` and `RESEND_FROM`; the list additionally needs a Resend segment, whose id goes in `RESEND_SEGMENT_ID`. Setting the API key alone never sends contacts. Once the segment is set, changes are sent hourly or with **Send changes now**.

**Unsubscribes made in Resend** (for example from a newsletter's unsubscribe link) come back through the Resend webhook: add the store's webhook address in Resend and include the contact events (`contact.updated`, `contact.deleted`) and `suppression.added` along with the email events. They are recorded here as unsubscribes; a later sync never resubscribes anyone, and only a new signup in the store (a box they tick) can. Before sending anyone as subscribed again, the store also checks Resend in case a webhook was missed. Read the review list on the Email list page before relying on the freebie signup offer.

**Reports and emails:** free claims are listed as "Free claim", counted separately on the Overview, and left out of orders, sales and customers. They do not count as verified purchases for reviews, and get no review requests. Download reminders skip them unless you tick "Also for free Freebie Corner claims" under Email Automations. Each claim gets a "Your free resource is ready" email with a My downloads button.
