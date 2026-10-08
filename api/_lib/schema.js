// Single source of truth for the Sheet layout on the server side.
// (public/logic.js mirrors the enum values; test/schema.test.js keeps them in sync.)

const LEADS_TAB = 'Leads';
const ACTIVITY_TAB = 'Activity';

const HEADERS = [
  'Gym Name', 'City', 'Instagram Link', 'Followers', 'Last Post Date', 'Owner Name',
  'Website Link', 'Website Quality', 'Bio Link Type', 'Has Booking Form',
  'Has Follow-up Automation', 'Current Offer', 'Problem', 'Priority', 'Status',
  'Last Contact Date', 'Notes', 'Engagement Started', 'Engagement Touches', 'Package', 'Facebook Link',
];

const ACTIVITY_HEADERS = ['Timestamp', 'Date', 'Gym', 'City', 'Event', 'Detail'];

const ENUMS = {
  'Website Quality': ['None', 'Outdated', 'Modern'],
  'Bio Link Type': ['Linktree', 'None', 'Website'],
  'Has Booking Form': ['Yes', 'No'],
  'Has Follow-up Automation': ['Yes', 'No', 'Unknown'],
  'Current Offer': ['Free Trial', 'Paid Intro', 'None'],
  'Priority': ['High', 'Medium', 'Low'],
  'Status': ['Warming', 'DM Sent', 'Replied', 'Audit Sent', 'Price Sent', 'Closed', 'Lost'],
  'Package': ['Trial-to-Member System', 'Follow-up Add-on', 'Skip'],
};

const NUMERIC = ['Followers', 'Engagement Touches'];

function colLetter(i) {
  // 0 -> A. Only needs to cover < 26 columns.
  return String.fromCharCode(65 + i);
}

const LAST_COL = colLetter(HEADERS.length - 1); // U

module.exports = { LEADS_TAB, ACTIVITY_TAB, HEADERS, ACTIVITY_HEADERS, ENUMS, NUMERIC, colLetter, LAST_COL };
