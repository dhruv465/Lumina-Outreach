import mongoose from 'mongoose';
import BatchCall from '../BatchCall';

describe('BatchCall model', () => {
  it('defaults processedLeadIds to an empty array', () => {
    const doc = new BatchCall({
      name: 'b1',
      campaignId: new mongoose.Types.ObjectId(),
      leadIds: [new mongoose.Types.ObjectId()],
      createdBy: new mongoose.Types.ObjectId(),
    });
    expect(Array.isArray(doc.processedLeadIds)).toBe(true);
    expect(doc.processedLeadIds.length).toBe(0);
  });

  it('accepts ObjectIds in processedLeadIds', () => {
    const leadId = new mongoose.Types.ObjectId();
    const doc = new BatchCall({
      name: 'b2',
      campaignId: new mongoose.Types.ObjectId(),
      leadIds: [leadId],
      createdBy: new mongoose.Types.ObjectId(),
      processedLeadIds: [leadId],
    });
    expect(doc.processedLeadIds[0].toString()).toBe(leadId.toString());
  });
});
