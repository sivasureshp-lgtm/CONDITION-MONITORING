# 📘 Neutral Glass - Instrumentation Monitoring System
## Complete Application Documentation

---

## 📋 Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [Features & Capabilities](#features--capabilities)
4. [Plant Configuration](#plant-configuration)
5. [User Guide](#user-guide)
6. [Technical Architecture](#technical-architecture)
7. [Data Management](#data-management)
8. [Deployment Information](#deployment-information)
9. [Cost Analysis](#cost-analysis)
10. [Future Enhancements](#future-enhancements)
11. [Support & Maintenance](#support--maintenance)

---

## 1. Executive Summary

### 1.1 Purpose
The Neutral Glass Instrumentation Monitoring System is a comprehensive web-based application designed for the Instrumentation Department to monitor, track, and analyze motor current readings, temperatures, and I²t values across all glass manufacturing plants (A, G, K, E).

### 1.2 Key Benefits
- ✅ **Time Saving**: Bulk entry of all motors (33 motors in 1 submission vs 33 separate entries)
- ✅ **Data Validation**: Photo verification prevents fake data entry
- ✅ **Real-time Alerts**: Immediate notification of alarm conditions
- ✅ **Cloud Backup**: Optional Google Sheets integration for data backup
- ✅ **Mobile Ready**: Works on phones, tablets, and desktops
- ✅ **Professional**: Industrial-grade Swiss design for reliability

### 1.3 Target Users
- Field Technicians (data entry with photo verification)
- Maintenance Engineers (monitoring & analysis)
- Plant Managers (overview & decision making)
- Instrumentation Department Head (reporting & compliance)

---

## 2. System Overview

### 2.1 Application Type
**Web Application** - Accessible via browser on any device

### 2.2 Access Methods
- **Desktop**: Any modern browser (Chrome, Firefox, Edge, Safari)
- **Mobile**: Chrome (Android), Safari (iPhone)
- **Tablet**: Full responsive support
- **Optional PWA**: Install as app icon on home screen

### 2.3 Live URL
**Preview**: https://control-diagnostics.preview.emergentagent.com
**Production**: (To be assigned after deployment)

### 2.4 No Installation Required
- Access via browser - no app store needed
- No downloads, no installations
- Just share URL with team members
- Works immediately

---

## 3. Features & Capabilities

### 3.1 Dashboard
**Purpose**: Real-time overview of plant health and active alarms

**Features**:
- Active alarm display (highlighted in red)
- Alarm count with details (Plant, Machine, Motor, Current vs Limit)
- Plant health status (percentage calculation)
- OK/Warning/Alarm breakdown per plant
- System status indicator

**Use Case**: 
Plant manager opens dashboard in morning to see:
- 9 Active Alarms requiring immediate attention
- Plant A: 93% health, Plant G: 87% health
- Specific motors exceeding warning thresholds

### 3.2 Bulk Reading Entry
**Purpose**: Fast data entry for entire machine at once

**Features**:
- Select Plant → Select Machine
- Displays ALL motors for that machine in table format
- Multiple parameters based on machine type:
  - Current (A) for A, G plants
  - Current + Temperature for E, K2, K3
  - I²t + Temperature for K1, K4
- Pre-filled Normal & Warning limits
- Single photo upload for entire machine
- Technician name entry
- Auto-calculation of status (OK/Warning/Alarm)

**Workflow**:
1. Technician selects Plant G → Machine G1
2. Table shows all 33 motors
3. Enters current values for all motors
4. Uploads one photo of the machine
5. Enters name
6. Clicks "Submit All Readings"
7. Data saved to MongoDB + Google Sheets (if enabled)

**Time Saved**: 15-20 minutes per machine entry!

### 3.3 View Data & Charts
**Purpose**: Historical data analysis and trend visualization

**Features**:
- Plant selector (A, G, K, E)
- Machine selector (all machines per plant)
- Motor current trend chart with:
  - Normal threshold line (green dashed)
  - Warning threshold line (red dashed)
  - Actual current values (blue line)
- Machine health status display:
  - OK count (green)
  - Warning count (yellow)
  - Alarm count (red)
  - Health percentage
- Recent readings table showing:
  - Timestamp
  - Motor name
  - Current/Temp/I²t values
  - Status
  - Photo (view button if available)
  - Entry source (Field/Office)

**Export Option**: Download data as Excel/CSV (ready to implement)

### 3.4 Photo Verification System
**Purpose**: Prevent fake data entry and provide visual proof

**Features**:
- Camera capture (mobile) or file upload (desktop)
- Automatic timestamp watermark added to photos
- "VERIFIED" badge in Neutral Glass blue
- Photo linked to all readings in that submission
- View photo button in data table
- Photos stored with readings

**Smart Photo Logic** (Ready to implement):
- All readings OK → Photo optional
- Any reading Warning → Photo recommended
- Any reading Alarm → Photo required

### 3.5 Data Validation
**Purpose**: Ensure data accuracy and prevent bulk fake entries

**Features**:
- Entry source tracking (Field vs Office)
- Bulk entry detection (flags if >5 entries in 1 minute)
- Verified by field (technician name)
- Photo verification increases trust
- Timestamp tracking (reading time vs entry time)

---

## 4. Plant Configuration

### 4.1 Complete Plant Structure

#### **Plant A** (Current only)
- **A1**: 33 motors
  - Basic: TubeRotation, TubeHeight, Feeder, Shear1, Shear2, Gob Distributor, Main Conveyor, Ware Transfer, Cross Conveyor
  - Sections 1-8: Takeout, Pusher Arm, Pusher Finger (each section)

- **A2**: 24 motors
  - Basic: TubeRotation, TubeHeight, Feeder, Shear1, Shear2, Gob Distributor, Main Conveyor, Ware Transfer, Cross Conveyor
  - Sections 1-8: Pusher Arm, Pusher Finger (each section)

- **A3**: 4 motors
  - Tube Rotation, Feeder, Main Conveyor, Stacker

- **A4**: 36 motors
  - Basic: TubeRotation, TubeHeight, Feeder, Shear1, Shear2, Gob Distributor, Main Conveyor, Ware Transfer, Cross Conveyor
  - Sections 1-8: Invert, Takeout, Pusher Arm, Pusher Finger (each section)

#### **Plant G** (Current only)
- **G1**: 33 motors (same as A1)
- **G2**: 33 motors (same as A1)
- **G3A**: 30 motors
  - Basic: TubeRotation, TubeHeight, Feeder, Shear1, Shear2, Gob Distributor
  - Sections 1-6: Invert, Takeout, Pusher Arm, Pusher Finger
  - Shared: Main Conveyor, Ware Transfer, Cross Conveyor, Stacker

- **G3B**: 26 motors
  - Basic: TubeRotation, TubeHeight, Feeder, Shear1, Shear2, Gob Distributor
  - Sections 1-6: Invert, Takeout, Pusher Arm, Pusher Finger
  - (Shares conveyors with G3A)

#### **Plant K**
- **K1**: 24 motors (I²t + Temperature, NO current)
  - Basic: Feeder, Tube Rotation, Tube Height, Shear, Gob Distributor, Main Conveyor, Ware Transfer, Cross Conveyor
  - Sections 1-8: Pusher Arm, Pusher Finger

- **K2**: 6 motors (Current + Temperature)
  - Tube Rotation, Feeder, Main Conveyor, Ware Transfer, Cross Conveyor, Stacker

- **K3**: 6 motors (Current + Temperature) - Same as K2

- **K4**: 24 motors (I²t + Temperature, NO current) - Same as K1

#### **Plant E** (Current + Temperature)
- **E1**: 8 motors
  - Tube Rotation, Feeder, Drum, Pusher, Main Conveyor, Ware Transfer, Cross Conveyor, Stacker

- **E2**: 6 motors
  - Tube Rotation, Feeder, Main Conveyor, Ware Transfer, Cross Conveyor, Stacker

- **E3**: 8 motors (Same as E1)

### 4.2 Parameter Types
- **Current (A)**: Motor current in Amperes
- **Temperature (°C)**: Drive temperature in Celsius
- **I²t (A²s)**: Thermal overload parameter (I-squared-t)

### 4.3 Threshold Configuration
Each motor has:
- **Normal Threshold**: Upper limit for normal operation
- **Warning Threshold**: Upper limit before alarm condition
- **Status Calculation**:
  - Current < Normal → Status = OK (Green)
  - Normal ≤ Current < Warning → Status = Warning (Yellow)
  - Current ≥ Warning → Status = Alarm (Red)

---

## 5. User Guide

### 5.1 For Field Technicians

#### Adding Readings (Step-by-Step)

**Step 1: Navigate to Bulk Entry**
- Open app URL in browser
- Click "Add Readings" in navigation

**Step 2: Select Machine**
- Select Plant (A, G, K, or E)
- Select Machine (e.g., G1)
- All motors for that machine appear in table

**Step 3: Enter Values**
- Enter current/temperature/I²t values for each motor
- Normal and Warning limits are pre-filled
- Fill only the required columns based on machine type

**Step 4: Add Photo (Optional but Recommended)**
- Click "Capture / Upload Photo"
- Take photo of the machine
- Photo preview appears
- Timestamp will be added automatically on submit

**Step 5: Enter Name**
- Enter your name in "Technician Name" field

**Step 6: Submit**
- Click "Submit All Readings"
- Wait for confirmation
- Data saved to database + cloud (if enabled)

**Time Required**: 3-5 minutes for entire machine (all motors)

#### Viewing Data

**Step 1: Navigate to View Data**
- Click "View Data" in navigation

**Step 2: Select Plant & Machine**
- Click on Plant button (A, G, K, E)
- Click on Machine button (e.g., K1)

**Step 3: View Results**
- Chart shows trend over time
- Table shows recent readings
- Machine health status displayed
- Click "View" on photo column to see verification photos

### 5.2 For Managers

#### Checking Alarms

**Step 1: Open Dashboard**
- Dashboard is the home page
- Shows active alarms immediately

**Step 2: Review Alarms**
- Red alarm cards show:
  - Plant and Machine
  - Motor name
  - Current value (in red)
  - Warning limit
  - Timestamp

**Step 3: Take Action**
- Contact technician
- Schedule maintenance
- Monitor trend in "View Data" page

#### Monitoring Plant Health

**Dashboard Shows**:
- Overall plant health percentage
- OK/Warning/Alarm breakdown
- Individual machine health status

**Green = Good** (90%+ health)
**Yellow = Attention** (70-90% health)
**Red = Critical** (<70% health)

### 5.3 For IT/Admin

#### Enabling Google Sheets Sync

See separate document: `GOOGLE_SHEETS_SETUP.md`

**Summary**:
1. Create Google Sheet
2. Create Service Account in Google Cloud
3. Share Sheet with service account
4. Provide JSON key + Sheet ID
5. Enable in backend .env file
6. Restart backend

**Result**: Every submission automatically adds rows to Google Sheet

#### Backup & Export

**Current**: Data in MongoDB database
**Optional**: Google Sheets (cloud backup)
**Future**: Excel/CSV export button

---

## 6. Technical Architecture

### 6.1 Technology Stack

**Frontend**:
- React.js (UI framework)
- Tailwind CSS + Shadcn UI (styling)
- Recharts (data visualization)
- Axios (API calls)
- React Router (navigation)
- Phosphor Icons (iconography)

**Backend**:
- FastAPI (Python web framework)
- MongoDB (database)
- ChromaDB (vector storage - for future RAG features)
- Pillow (image processing for watermarks)
- gspread (Google Sheets integration)

**Infrastructure**:
- Emergent Platform (hosting)
- MongoDB Atlas-compatible database
- Environment variables for configuration
- Supervisor for process management

### 6.2 System Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                       │
│  - Dashboard                                     │
│  - Bulk Entry Form                               │
│  - Data Visualization                            │
└─────────────┬───────────────────────────────────┘
              │ HTTPS/REST API
              │
┌─────────────▼───────────────────────────────────┐
│           Backend (FastAPI)                      │
│  - API Endpoints                                 │
│  - Business Logic                                │
│  - Photo Processing (Watermarks)                 │
│  - Google Sheets Sync                            │
└─────────────┬───────────────────────────────────┘
              │
    ┌─────────┴──────────┬──────────────────┐
    │                    │                   │
┌───▼────┐      ┌────────▼──────┐    ┌──────▼────────┐
│MongoDB │      │ Google Sheets │    │ File Storage  │
│Database│      │  (Optional)   │    │   (Photos)    │
└────────┘      └───────────────┘    └───────────────┘
```

### 6.3 Data Flow

**Adding Readings**:
1. User fills bulk entry form
2. Frontend validates input
3. Sends POST request to `/api/condition-monitoring/bulk`
4. Backend processes each reading:
   - Calculates status (OK/Warning/Alarm)
   - Processes photo (adds watermark)
   - Saves to MongoDB
   - Syncs to Google Sheets (if enabled)
5. Returns confirmation to frontend
6. Frontend shows success message

**Viewing Data**:
1. User selects plant & machine
2. Frontend sends GET request to `/api/condition-monitoring/machine/{plant}/{machine}`
3. Backend queries MongoDB
4. Returns readings sorted by timestamp
5. Frontend transforms data for charts
6. Displays chart + table

**Dashboard Alarms**:
1. Dashboard loads
2. Frontend sends GET to `/api/active-alarms`
3. Backend aggregates latest readings
4. Filters for Alarm status
5. Returns alarm list
6. Frontend displays red alarm cards

### 6.4 Database Schema

**Collection**: `condition_monitoring`

**Document Structure**:
```json
{
  "plant": "G",
  "machine": "G1",
  "motor": "Sec1 Pusher Arm",
  "current": 2.87,
  "normal_current": 3.0,
  "warning_current": 4.0,
  "temperature": 65.5,
  "normal_temperature": 70,
  "warning_temperature": 85,
  "i2t": null,
  "normal_i2t": null,
  "warning_i2t": null,
  "status": "OK",
  "timestamp": "2026-04-09T15:30:45.123Z",
  "entry_timestamp": "2026-04-09T15:30:45.123Z",
  "entry_source": "Field",
  "verified_by": "Rajesh K",
  "notes": null,
  "bulk_entry_flag": false,
  "has_photo": true,
  "photo": "data:image/jpeg;base64,...",
  "verified": true
}
```

### 6.5 API Endpoints

**Machine Configuration**:
- `GET /api/machine-config/{plant}/{machine}` - Get motors for a machine

**Condition Monitoring**:
- `POST /api/condition-monitoring/bulk` - Bulk entry submission
- `GET /api/condition-monitoring/plant/{plant}` - All readings for a plant
- `GET /api/condition-monitoring/machine/{plant}/{machine}` - Machine readings

**Analytics**:
- `GET /api/active-alarms` - Current active alarms
- `GET /api/plant-health` - Health status for all plants
- `GET /api/machine-health/{plant}` - Health status per machine in plant

### 6.6 Security

**Current**:
- No authentication (as requested by client)
- CORS enabled for frontend domain
- Input validation on backend
- Environment variables for sensitive data

**Recommended for Production**:
- Add authentication (JWT/OAuth)
- Rate limiting
- HTTPS only
- Input sanitization

---

## 7. Data Management

### 7.1 Data Storage

**Primary Storage**: MongoDB
- All readings stored permanently
- Fast queries and aggregations
- Scalable for millions of records

**Cloud Backup**: Google Sheets (Optional)
- Real-time sync on every submission
- Accessible from anywhere
- Share with team members
- Create reports and charts in Sheets

**Photo Storage**:
- Base64 encoded in MongoDB
- Includes timestamp watermark
- Compressed to optimize storage

### 7.2 Data Retention

**Current**: Unlimited retention
**Recommendation**: Archive data older than 2 years

### 7.3 Data Access

**Who Can Access**:
- All team members (no authentication currently)
- Future: Role-based access (Admin, Manager, Technician, Viewer)

**Access Methods**:
- Web application (all features)
- Google Sheets (if enabled) - read-only for team
- API access (for integrations)

### 7.4 Data Export

**Current Options**:
- View in browser
- Google Sheets sync (automatic)

**Future Options**:
- Excel/CSV download
- PDF reports
- Scheduled email reports

---

## 8. Deployment Information

### 8.1 Deployment Options

**Option 1: Emergent Platform** (Recommended)
- **Cost**: 50 credits/month
- **Includes**: Hosting, MongoDB, SSL, Custom domain
- **Updates**: Unlimited, free
- **Deployment**: Click-button deployment

**Option 2: Custom Server**
- Self-host on your own infrastructure
- Requires technical expertise
- One-time setup, ongoing maintenance

### 8.2 Deployment Process (Emergent)

1. **Pre-deployment**:
   - Review application
   - Test all features
   - Configure environment variables

2. **Deploy**:
   - Click "Deploy to Production"
   - Choose custom domain (optional)
   - Wait 2-3 minutes

3. **Post-deployment**:
   - Verify all features work
   - Share URL with team
   - Monitor usage

### 8.3 Custom Domain

**Default**: `your-app-name.emergentagent.com`
**Custom** (Optional): `monitoring.neutralglass.com`

**Setup**:
1. Choose custom domain
2. Update DNS settings (provided)
3. SSL certificate auto-generated

### 8.4 Environment Variables

**Required**:
- `MONGO_URL` - MongoDB connection string
- `DB_NAME` - Database name
- `CORS_ORIGINS` - Allowed frontend domains

**Optional**:
- `GOOGLE_SHEETS_ENABLED` - Enable Google Sheets sync
- `GOOGLE_SHEET_ID` - Sheet ID for sync
- `EMERGENT_LLM_KEY` - For RAG features (future)

---

## 9. Cost Analysis

### 9.1 Deployment Costs

**Web Application Deployment**:
- **Initial**: 50 credits/month
- **Updates**: FREE (unlimited)
- **Ongoing**: 50 credits/month only

**What's Included**:
✅ 24/7 hosting
✅ MongoDB database (unlimited for your usage)
✅ SSL certificate (HTTPS)
✅ Custom domain support
✅ File storage (photos)
✅ Unlimited team members
✅ Unlimited data entries
✅ Unlimited updates/changes

### 9.2 Additional Costs (Optional)

**Google Sheets API**: FREE
- 600 requests/minute quota
- Your usage: ~100-500 requests/day
- Well within free tier

**Custom Domain**: FREE
- Included in deployment

**PWA Features**: FREE
- No additional cost
- Just configuration

**Google Play Store** (NOT RECOMMENDED):
- Google Developer account: $25 one-time
- Emergent Mobile Agent: Extra subscription
- More expensive, not necessary

### 9.3 Cost Comparison

**Alternatives**:

**AWS Hosting**:
- EC2 instance: $20-50/month
- RDS database: $15-30/month
- S3 storage: $5-10/month
- Load balancer: $15/month
- **Total**: $55-105/month + setup complexity

**Heroku**:
- Dyno: $25/month
- Database: $9/month
- **Total**: $34/month (limited features)

**Emergent**:
- **Total**: 50 credits/month (~$50/month equivalent)
- **Advantage**: No setup, unlimited updates, easier

### 9.4 ROI Analysis

**Time Savings**:
- Old method: 33 motors × 2 minutes = 66 minutes per machine
- New method: All 33 motors = 5 minutes per machine
- **Saved**: 61 minutes per machine entry!

**If 10 machines/day**:
- Daily savings: 610 minutes = 10 hours
- Monthly savings: 200+ hours
- Annual savings: 2,400+ hours

**Value**: Even at minimum wage, ROI is achieved in first month!

---

## 10. Future Enhancements

### 10.1 Ready to Implement

**Alert Notifications** (Email/SMS):
- Send email when alarm detected
- Daily summary reports
- WhatsApp integration

**Excel Export**:
- Download button on View Data page
- Filter by date range
- Custom report generation

**PWA Features**:
- Install as app on home screen
- Offline support
- Push notifications

### 10.2 Planned Features

**Advanced Analytics**:
- Predictive maintenance (ML)
- Anomaly detection
- Trend forecasting

**User Management**:
- Role-based access control
- Admin, Manager, Technician, Viewer roles
- Activity logs

**Reporting**:
- Automated weekly/monthly reports
- PDF generation
- Email delivery

**Mobile App** (If needed):
- Native Android/iOS app
- Offline data entry
- Background sync

### 10.3 RAG Expert System (Disabled)

**Capability**: AI-powered troubleshooting assistant
- Upload SOPs, manuals, P&IDs
- Ask questions in natural language
- Get expert recommendations

**Status**: Built but disabled (to avoid LLM costs)
**Can Enable**: If needed in future with your manuals

---

## 11. Support & Maintenance

### 11.1 Regular Maintenance

**Weekly**:
- Check active alarms
- Verify data sync (if Google Sheets enabled)
- Monitor storage usage

**Monthly**:
- Review plant health trends
- Archive old data (if needed)
- Update team member list

**Quarterly**:
- Review system performance
- Plan new features
- User feedback session

### 11.2 Troubleshooting

**Common Issues**:

**Issue**: Data not saving
**Solution**: 
- Check internet connection
- Verify all required fields filled
- Check backend logs

**Issue**: Photo not uploading
**Solution**:
- Check file size (<5MB recommended)
- Use JPEG/PNG format
- Check camera permissions

**Issue**: Charts not loading
**Solution**:
- Refresh browser
- Clear cache
- Check if data exists for selected machine

### 11.3 Getting Help

**Documentation**:
- This document
- `GOOGLE_SHEETS_SETUP.md`
- `READY_TO_ENABLE_SHEETS.md`

**Support Channels**:
- Emergent platform support
- Email support (if set up)
- Internal IT team

### 11.4 Updates & Changes

**How Updates Work**:
1. Request changes/new features
2. Development & testing
3. Deploy update (takes 2 minutes)
4. All users see changes immediately
5. **No downtime, no extra cost!**

---

## 12. Appendix

### 12.1 Glossary

- **Bulk Entry**: Entering readings for all motors of a machine at once
- **I²t**: Thermal overload parameter (Current squared × time)
- **MongoDB**: NoSQL database for storing readings
- **PWA**: Progressive Web App (web app that acts like mobile app)
- **RAG**: Retrieval-Augmented Generation (AI feature)
- **Status**: OK/Warning/Alarm based on threshold comparison

### 12.2 Technical Specifications

**Browser Requirements**:
- Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- JavaScript enabled
- Cookies enabled
- Camera access (for photo verification)

**Network Requirements**:
- Internet connection required
- Minimum 3G speed
- HTTPS support

**Device Requirements**:
- Desktop: Any modern computer
- Mobile: Android 8+, iOS 12+
- Tablet: iPad/Android tablets

### 12.3 Contact Information

**Application Owner**: Neutral Glass - Instrumentation Department
**Deployment Platform**: Emergent
**Live URL**: (To be assigned after deployment)

---

## Document Version
**Version**: 1.0  
**Date**: April 2026  
**Author**: Development Team  
**Status**: Production Ready

---

## Quick Reference Card

### URLs
- **Preview**: https://control-diagnostics.preview.emergentagent.com
- **Production**: (TBD after deployment)

### Navigation
- **Dashboard**: Home page, view alarms
- **Add Readings**: Bulk entry form
- **View Data**: Charts and historical data

### Key Features
- ✅ Bulk entry (all motors at once)
- ✅ Photo verification with timestamp
- ✅ Real-time alarms
- ✅ Trend charts
- ✅ Google Sheets sync (optional)
- ✅ Mobile responsive

### Costs
- **Deployment**: 50 credits/month
- **Updates**: FREE
- **Users**: Unlimited
- **Data**: Unlimited

### Support Files
- `GOOGLE_SHEETS_SETUP.md` - Setup guide
- `READY_TO_ENABLE_SHEETS.md` - Quick enable
- This document - Complete reference

---

**END OF DOCUMENTATION**
