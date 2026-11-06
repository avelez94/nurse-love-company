# Future tutorials

Each one reuses `template/` and the same synthetic customer approach. "Verify first" lists what must be confirmed
before it is shown on screen; nothing in that column has been verified yet.

| # | Tutorial | What it shows (verified in the site today) | Verify first |
| --- | --- | --- | --- |
| 1 | **How to print your inserts** | Finding the page size and orientation on the product page and in My downloads (the product page shows page size, orientation and file format when the store has filled them in; the binder notice "Binder not included" appears on inserts). | Mom's recommended print settings (actual size vs fit to page, paper weight, single or double sided), shown on a real PDF in at least one common print dialog. The site does not control printing, so every print screen must be captured, not drawn. |
| 2 | **How to assemble your binder** | The binder notice on inserts; that inserts are printed at home. | The binder size and hole punch the inserts are designed for, section order, and whether dividers are included in any product. Real photos or video of assembly from mom. |
| 3 | **Using your digital files** | Product files can be PDF, ZIP, PNG or JPG (the upload check in `server/lib/files.ts`). The product page lists "Confirmed uses" and app compatibility only when the store enters them. | Which formats each product actually ships in; for ZIP files, how to open them on a computer, iPhone and Android. Any app (GoodNotes, Notability, Adobe Acrobat, Files) must be tested with a real product file before it is named. Fillable fields must be tested in each app named. |
| 4 | **Downloading an updated version** | When a new version is released, each eligible buyer gets one new download of it; older unused downloads are replaced, not added; My downloads shows the version number, the update date and "Updated version available • 1 new download". The product update email is optional for customers. | Capture the "Update available" card and the email with the synthetic customer after releasing a version 2 of the sample product on the local site. |
| 5 | **Creating your account and signing in** | Create account (first name, last name, email, password of at least 10 characters), Forgot your password. | Capture the password reset email with the synthetic customer (needs Resend test sending on the local site). |
| 6 | **Getting a free resource from the Freebie Corner** | Free claims add the resource to My downloads with one download. | Capture the claim flow with the synthetic customer. |
| 7 | **Reporting a download problem** | Report a download problem (one per item), reviewed by a person; downloads are never reset automatically; Support tab for other questions. | How long replies usually take, from mom. |

## Template follow ups

- Each tutorial is made twice, on a computer and on a phone, with the Heart voice and the original music.
- The owner may record her own voice later; the scripts in each tutorial.json (`say`) are ready to read.
- My downloads shows a "Watch the tutorial" link that is chosen from tutorials linked to NP insert products. Once the
  download tutorial is published, point that link at it.
