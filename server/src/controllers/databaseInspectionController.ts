import { FastifyRequest, FastifyReply } from 'fastify';
import Call from '../models/Call';

export const inspectDatabase = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    console.log('Debug: Checking database state...');
    
    // Get total call count
    const totalCalls = await Call.countDocuments();
    console.log(`Total calls in database: ${totalCalls}`);
    
    // Get a sample of calls to see their structure
    const sampleCalls = await Call.find({}).limit(5).lean();
    console.log('Sample calls:', JSON.stringify(sampleCalls, null, 2));
    
    // Check date field usage
    const callsWithStartTime = await Call.countDocuments({ startTime: { $exists: true, $ne: null } });
    const callsWithCreatedAt = await Call.countDocuments({ createdAt: { $exists: true, $ne: null } });
    const callsWithScheduledAt = await Call.countDocuments({ scheduledAt: { $exists: true, $ne: null } });
    
    console.log(`Calls with startTime: ${callsWithStartTime}`);
    console.log(`Calls with createdAt: ${callsWithCreatedAt}`);
    console.log(`Calls with scheduledAt: ${callsWithScheduledAt}`);
    
    // Check status distribution
    const statusDistribution = await Call.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    console.log('Status distribution:', statusDistribution);
    
    // Check outcome distribution
    const outcomeDistribution = await Call.aggregate([
      { $group: { _id: '$outcome', count: { $sum: 1 } } }
    ]);
    console.log('Outcome distribution:', outcomeDistribution);
    
    // Check recent calls
    const recentCalls = await Call.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .select('status outcome createdAt startTime scheduledAt duration')
      .lean();
    console.log('Recent calls:', recentCalls);
    
    res.send({
      totalCalls,
      callsWithStartTime,
      callsWithCreatedAt,
      callsWithScheduledAt,
      statusDistribution,
      outcomeDistribution,
      sampleCalls: sampleCalls.slice(0, 2), // Only send first 2 to avoid overwhelming response
      recentCalls
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).send({ error: 'Debug failed', details: error.message });
  }
};
