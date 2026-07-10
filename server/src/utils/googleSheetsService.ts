import { google } from 'googleapis';
import logger from './logger';
import path from 'path';

// Use the same credentials as Dialogflow
const auth = new google.auth.GoogleAuth({
  keyFile: path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS || './lumina-outreach-c4082e500293.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

/**
 * Append a row to a Google Sheet
 * @param spreadsheetId The ID of the spreadsheet
 * @param range The range to append to (e.g., 'Sheet1!A1')
 * @param values The row data to append
 */
export async function appendToSheet(spreadsheetId: string, range: string, values: any[]) {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });
    logger.info(`Successfully appended data to Google Sheet ${spreadsheetId}`);
    return response.data;
  } catch (error) {
    logger.error(`Error appending to Google Sheet: ${error.message}`);
    throw error;
  }
}

/**
 * Create a new spreadsheet and return its ID
 * @param title The title of the new spreadsheet
 */
export async function createSpreadsheet(title: string) {
  try {
    const response = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title,
        },
      },
    });
    const spreadsheetId = response.data.spreadsheetId;
    logger.info(`Created new Google Sheet with title "${title}" and ID ${spreadsheetId}`);
    return spreadsheetId;
  } catch (error) {
    logger.error(`Error creating Google Sheet: ${error.message}`);
    throw error;
  }
}
