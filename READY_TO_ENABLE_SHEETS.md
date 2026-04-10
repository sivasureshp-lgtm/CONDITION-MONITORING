# WHEN YOU'RE READY TO ENABLE GOOGLE SHEETS AUTO-SYNC

## What You Need to Give Me:

1. **service_account.json** file (the JSON key you download from Google Cloud)
2. **Sheet ID** (from your Google Sheet URL)

## What I'll Do (Takes 2 minutes):

1. Upload your `service_account.json` to `/app/backend/`
2. Add these 2 lines to `/app/backend/.env`:
   ```
   GOOGLE_SHEETS_ENABLED=true
   GOOGLE_SHEET_ID=your_sheet_id_here
   ```
3. Restart backend
4. Test it works!

## How It Works After Setup:

✅ User submits bulk readings
✅ Data saves to MongoDB (for app to work)
✅ **Automatically adds rows to Google Sheet** (cloud backup!)
✅ You can access Sheet from anywhere
✅ Share with team members
✅ Always backed up in cloud

## No Rush!

Follow the guide in `GOOGLE_SHEETS_SETUP.md` when you're ready.
Just ping me when you have the 2 items and I'll set it up instantly! 🚀
