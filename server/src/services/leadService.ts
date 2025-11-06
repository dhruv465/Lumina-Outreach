import Lead from '../models/Lead';
import mongoose from 'mongoose';
import csv from 'csv-parser';
import fs from 'fs';

class LeadService {
  async uploadLeads(leads: any[]) {
    if (!Array.isArray(leads)) {
      leads = [leads];
    }

    if (leads.length === 0) {
      throw new Error('No leads provided');
    }

    const createdLeadDocuments = await Lead.create(leads);

    const createdLeads = createdLeadDocuments.map(lead => ({
      ...lead.toObject(),
      id: lead._id.toString(),
    }));

    return createdLeads;
  }

  async getLeads(options: any) {
    const { page = 1, limit = 10, status, source, language, search } = options;
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (language) filter.languagePreference = language;

    if (search) {
      const searchRegex = new RegExp(search as string, 'i');
      filter.$or = [
        { name: searchRegex },
        { phoneNumber: searchRegex },
        { email: searchRegex },
      ];
    }

    const leadDocuments = await Lead.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const leads = leadDocuments.map(lead => ({
      ...lead.toObject(),
      id: lead._id.toString(),
    }));

    const total = await Lead.countDocuments(filter);

    return {
      leads,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getLeadById(id: string) {
    const leadDocument = await Lead.findById(id);
    if (!leadDocument) {
      return null;
    }
    return {
      ...leadDocument.toObject(),
      id: leadDocument._id.toString(),
    };
  }

  async updateLead(id: string, data: any) {
    const lead = await Lead.findById(id);
    if (!lead) {
      throw new Error('Lead not found');
    }

    Object.assign(lead, data);

    const updatedLeadDocument = await lead.save();

    return {
      ...updatedLeadDocument.toObject(),
      id: updatedLeadDocument._id.toString(),
    };
  }

  async deleteLead(id: string) {
    const lead = await Lead.findById(id);
    if (!lead) {
      throw new Error('Lead not found');
    }
    await lead.deleteOne();
  }

  async importLeadsFromCSV(filepath: string) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const results: any[] = [];
      const errors: any[] = [];

      const stream = fs.createReadStream(filepath).pipe(csv());

      for await (const data of stream) {
        if (!data.name || !data.phoneNumber || !data.source) {
          errors.push({ row: data, error: 'Missing required fields' });
          continue;
        }

        results.push({
          name: data.name,
          phoneNumber: data.phoneNumber,
          email: data.email || undefined,
          company: data.company || undefined,
          title: data.title || undefined,
          source: data.source,
          languagePreference: data.languagePreference || 'English',
          status: 'New',
          tags: data.tags ? data.tags.split(',').map((tag: string) => tag.trim()) : [],
        });
      }

      if (errors.length > 0) {
        await session.abortTransaction();
        session.endSession();
        fs.unlinkSync(filepath);
        throw new Error('CSV contains invalid data');
      }

      if (results.length === 0) {
        await session.abortTransaction();
        session.endSession();
        fs.unlinkSync(filepath);
        throw new Error('No valid leads found in CSV');
      }

      const createdLeads = await Lead.create(results, { session });

      await session.commitTransaction();
      session.endSession();

      fs.unlinkSync(filepath);

      return createdLeads;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      fs.unlinkSync(filepath);
      throw error;
    }
  }

  async getLeadAnalytics() {
    const totalLeads = await Lead.countDocuments();

    const leadsByStatus = await Lead.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { status: '$_id', count: 1, _id: 0 } },
    ]);

    const leadsBySource = await Lead.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $project: { source: '$_id', count: 1, _id: 0 } },
    ]);

    const leadsByLanguage = await Lead.aggregate([
      { $group: { _id: '$languagePreference', count: { $sum: 1 } } },
      { $project: { language: '$_id', count: 1, _id: 0 } },
    ]);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const leadsOverTime = await Lead.aggregate([
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          date: '$_id',
          count: 1,
          _id: 0,
        },
      },
      {
        $sort: { date: 1 },
      },
    ]);

    return {
      totalLeads,
      leadsByStatus,
      leadsBySource,
      leadsByLanguage,
      leadsOverTime,
    };
  }

  async exportLeads(options: any) {
    const { format = 'csv', status, source, language } = options;

    const query: Record<string, any> = {};

    if (status) query.status = status;
    if (source) query.source = source;
    if (language) query.languagePreference = language;

    const leads = await Lead.find(query).sort({ createdAt: -1 });

    const exportData = leads.map((lead: any) => ({
      id: lead._id,
      name: lead.name,
      phoneNumber: lead.phoneNumber,
      email: lead.email || '',
      company: lead.company || '',
      title: lead.title || '',
      source: lead.source || '',
      status: lead.status,
      languagePreference: lead.languagePreference || '',
      callCount: lead.callCount,
      lastContacted: lead.lastContacted ? lead.lastContacted.toISOString() : '',
      notes: lead.notes || '',
      tags: lead.tags ? lead.tags.join(', ') : '',
    }));

    if (format === 'json') {
      return { format, data: exportData };
    } else if (format === 'csv') {
      const header = Object.keys(exportData[0] || {}).join(',') + '\n';
      const csv = exportData.length
        ? header +
          exportData
            .map((row: any) =>
              Object.values(row)
                .map(value => `"${String(value).replace(/"/g, '""')}"`)
                .join(','))
            .join('\n')
        : '';

      return { format, data: csv };
    } else {
      throw new Error('Unsupported format');
    }
  }

  async getLeadsForCalling(limit: number, language: string, excludeIds: string[]): Promise<any[]> {
    // Placeholder implementation
    return [];
  }

  async updateLeadAfterCall(leadId: string, status: string, notes: string, callbackDate?: Date): Promise<void> {
    // Placeholder implementation
  }
}

export default new LeadService();
