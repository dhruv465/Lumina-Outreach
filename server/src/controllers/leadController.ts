import { FastifyRequest, FastifyReply } from 'fastify';
import { leadService } from '../services/leadService';
import { handleError } from '../utils/errorHandling';


// @desc    Create single lead or upload multiple leads
// @route   POST /api/leads
// @access  Private
export const uploadLeads = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const leads = await leadService.uploadLeads((req.body as any).leads || req.body);
    res.status(201).send({ message: `Successfully created ${leads.length} leads`, leads });
  } catch (error) {
    res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

export const getLeads = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const result = await leadService.getLeads(req.query);
    return res.status(200).send(result);
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

export const getLeadById = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const lead = await leadService.getLeadById((req.params as any).id);
    if (!lead) {
      return res.status(404).send({ message: 'Lead not found' });
    }
    return res.status(200).send(lead);
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

export const updateLead = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const updatedLead = await leadService.updateLead((req.params as any).id, req.body);
    return res.status(200).send(updatedLead);
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

export const deleteLead = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    await leadService.deleteLead((req.params as any).id);
    return res.status(200).send({ message: 'Lead deleted successfully' });
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

export const importLeadsFromCSV = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<void> => {
  try {
    const data = await (req as any).file();
    if (!data) {
      res.status(400).send({ message: 'No file uploaded' });
      return;
    }
    const createdLeads = await leadService.importLeadsFromCSV(data.filepath);
    res.status(201).send({ message: `Successfully imported ${createdLeads.length} leads` });
  } catch (error) {
    res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

export const getLeadAnalytics = async (_req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const analytics = await leadService.getLeadAnalytics();
    return res.status(200).send(analytics);
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

export const exportLeads = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const result = await leadService.exportLeads(req.query);
    if (result.format === 'csv') {
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename=leads.csv');
      return res.status(200).send(result.data);
    } else {
      return res.status(200).send({ leads: result.data });
    }
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};
