import { FastifyRequest, FastifyReply } from 'fastify';
import Call from '../models/Call';
import logger from '../utils/logger';

// @desc    Update call status
// @route   PUT /api/calls/:id/status
// @access  Private
export const updateCallStatus = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const { status, notes } = req.body as any;
    
    if (!status) {
      return res.status(400).send({ message: 'Status is required' });
    }
    
    // Valid statuses
    const validStatuses = ['Initiated', 'Ringing', 'In-Progress', 'Completed', 'Failed', 'No-Answer', 'Busy'];
    if (!validStatuses.includes(status)) {
      return res.status(400).send({ 
        message: 'Invalid status',
        validStatuses
      });
    }
    
    // Find call
    const call = await Call.findById((req.params as any).id)
      .populate('lead', 'name phoneNumber')
      .populate('campaign', 'name');
      
    if (!call) {
      return res.status(404).send({ message: 'Call not found' });
    }
    
    // Update status
    call.status = status;
    
    // Add notes if provided
    if (notes) {
      call.notes = notes;
    }
    
    // If completing or failing, set endTime
    if (['Completed', 'Failed', 'No-Answer', 'Busy'].includes(status)) {
      call.endTime = new Date();
      
      // Calculate duration if we have a start time
      if (call.startTime) {
        const durationMs = call.endTime.getTime() - call.startTime.getTime();
        call.duration = Math.round(durationMs / 1000); // Convert to seconds
      }
    }
    
    await call.save();
    
    // Notification functionality has been removed
    logger.info('Call status updated:', call._id, 'to', status);
    
    return res.status(200).send({
      message: `Call status updated to ${status}`,
      call
    });
  } catch (error) {
    logger.error('Error in updateCallStatus:', error);
    return res.status(500).send({
      message: 'Server error',
      error: (error as Error).message
    });
  }
};
