import Lead from '../models/Lead';

export const getLeadPhoneNumber = async (leadId: string): Promise<string | null> => {
  try {
    const lead = await Lead.findById(leadId);
    return lead ? lead.phoneNumber : null;
  } catch (error) {
    console.error(`Error getting lead phone number: ${error}`);
    return null;
  }
};
