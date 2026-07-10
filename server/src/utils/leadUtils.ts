import Lead from '../models/Lead';
import logger from './logger';

export const getLeadPhoneNumber = async (leadId: string): Promise<string | null> => {
  try {
    const lead = await Lead.findById(leadId);
    return lead ? lead.phoneNumber : null;
  } catch (error) {
    logger.error(`Error getting lead phone number: ${error}`);
    return null;
  }
};
