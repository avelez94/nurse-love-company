# Owner guide: banners and the Nurse Kin popup

Everything here is in the store admin under **Marketing**. Nothing you create is visible to visitors until you press **Publish**.

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

## The Nurse Kin popup

Marketing, **Nurse Kin popup**. It stays a draft until you add the real Nurse Kin address and your own description.

1. Write the headline, what Nurse Kin is, and the button label (for example "Visit Nurse Kin"). Add the Nurse Kin address (`https://...`) and, if you like, a logo.
2. Choose when it appears: after a number of seconds on the site (default 30) **or** after scrolling part of a page (default 50%), whichever comes first.
3. Choose the pages. It never appears during sign in, password reset, checkout, the account pages or the admin, never over another window, and never while a tutorial video is playing.
4. Press **Show preview** to see it exactly as visitors will. Previews are never counted.
5. **Publish.**

How often visitors see it:
* at most once per visit;
* after "Maybe later" or closing it, not again for the number of days you choose (default 7);
* after clicking through to Nurse Kin, not again, unless you press **Start a new campaign**.

This memory lives in each visitor's browser, so it cannot follow someone to another device, and it resets if they clear their browsing data.

The popup only sends people to Nurse Kin. It does not sign anyone up or collect email addresses.

## Results

Each banner and the popup show **times shown**, **clicks**, **click rate** and **times closed**. They are simple totals with no personal information. A click to Nurse Kin means someone opened Nurse Kin, not that they joined.
