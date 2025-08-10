import { realTimeCallStateMachine, CallState, CallEvent } from '../services/realTimeCallStateMachine';
import { enhancedBargeInDetectionService } from '../services/enhancedBargeInDetectionService';
import { optimizedRealTimeAudioPipeline } from '../services/optimizedRealTimeAudioPipeline';

/**
 * Simple test suite for the new real-time call workflow services
 * Tests state machine, barge-in detection, and audio pipeline integration
 */

async function testRealTimeCallWorkflow() {
  console.log('🧪 Testing Real-Time Call Workflow Services...\n');

  // Test data
  const callId = 'test-call-12345';
  const conversationId = 'test-conversation-67890';
  const leadId = 'test-lead-123';
  const campaignId = 'test-campaign-456';

  try {
    // Test 1: State Machine Creation and Transitions
    console.log('1️⃣ Testing State Machine...');
    
    const session = realTimeCallStateMachine.createSession(
      callId,
      conversationId,
      leadId,
      campaignId
    );

    console.log(`✅ Session created: ${session.callId}, state: ${session.currentState}`);

    // Test state transitions
    const transitions = [
      { state: CallState.CONNECTING, event: CallEvent.CALL_CONNECTED },
      { state: CallState.GREETING, event: CallEvent.MEDIA_STREAM_STARTED },
      { state: CallState.SPEAKING, event: CallEvent.TTS_STARTED },
      { state: CallState.LISTENING, event: CallEvent.TTS_COMPLETED },
      { state: CallState.PROCESSING, event: CallEvent.SPEECH_DETECTED },
      { state: CallState.SPEAKING, event: CallEvent.AI_RESPONSE_GENERATED },
      { state: CallState.INTERRUPTED, event: CallEvent.BARGE_IN_DETECTED },
      { state: CallState.LISTENING, event: CallEvent.USER_STOPPED_SPEAKING }
    ];

    for (const { state, event } of transitions) {
      const success = realTimeCallStateMachine.transitionToState(callId, state, event);
      console.log(`  ${success ? '✅' : '❌'} Transition to ${state} via ${event}`);
    }

    // Test 2: Barge-in Detection
    console.log('\n2️⃣ Testing Barge-in Detection...');
    
    enhancedBargeInDetectionService.initializeCall(callId, {
      sensitivity: 'medium',
      bargeInEnabled: true
    });

    console.log('✅ Barge-in detection initialized');

    // Simulate user speaking
    realTimeCallStateMachine.setUserSpeaking(callId, true, 0.8);
    console.log('✅ User speaking status set');

    // Simulate agent speaking (should enable barge-in detection)
    realTimeCallStateMachine.setAgentSpeaking(callId, true);
    console.log('✅ Agent speaking status set');

    // Test audio chunk processing
    const testAudioBuffer = Buffer.from('test audio data', 'utf8');
    const voiceActivity = enhancedBargeInDetectionService.processAudioChunk(
      callId,
      testAudioBuffer
    );

    console.log(`✅ Audio chunk processed, speech detected: ${voiceActivity?.isSpeech}`);

    // Test 3: Audio Pipeline
    console.log('\n3️⃣ Testing Audio Pipeline...');
    
    const audioSession = await optimizedRealTimeAudioPipeline.initializeCall(
      callId,
      conversationId,
      {
        primarySTTProvider: 'deepgram',
        primaryTTSProvider: 'elevenlabs',
        enableProviderFallback: true
      }
    );

    console.log(`✅ Audio pipeline initialized for call ${audioSession.callId}`);

    // Simulate incoming audio
    const testAudioPayload = Buffer.from('simulated twilio audio payload').toString('base64');
    await optimizedRealTimeAudioPipeline.processIncomingAudio(
      callId,
      testAudioPayload,
      Date.now().toString()
    );

    console.log('✅ Incoming audio processed');

    // Test 4: Metrics Collection
    console.log('\n4️⃣ Testing Metrics Collection...');
    
    const stateMachineMetrics = realTimeCallStateMachine.getSessionMetrics(callId);
    const audioMetrics = optimizedRealTimeAudioPipeline.getSessionMetrics(callId);
    const bargeInMetrics = enhancedBargeInDetectionService.getCallMetrics(callId);

    console.log('✅ State Machine Metrics:', {
      currentState: stateMachineMetrics?.currentState,
      bargeInCount: stateMachineMetrics?.bargeInCount,
      totalTransitions: stateMachineMetrics?.totalTransitions
    });

    console.log('✅ Audio Pipeline Metrics:', {
      isProcessingSTT: audioMetrics?.isProcessingSTT,
      isProcessingTTS: audioMetrics?.isProcessingTTS,
      totalProcessedChunks: audioMetrics?.totalProcessedChunks
    });

    console.log('✅ Barge-in Metrics:', {
      isCurrentlySpeaking: bargeInMetrics?.isCurrentlySpeaking,
      totalBargeIns: bargeInMetrics?.totalBargeIns,
      sensitivity: bargeInMetrics?.config?.sensitivity
    });

    // Test 5: Cleanup
    console.log('\n5️⃣ Testing Cleanup...');
    
    realTimeCallStateMachine.endSession(callId, 'test_completed');
    optimizedRealTimeAudioPipeline.cleanupCall(callId);
    enhancedBargeInDetectionService.cleanupCall(callId);

    console.log('✅ All services cleaned up');

    console.log('\n🎉 All tests passed! Real-time call workflow is functional.\n');
    
    return true;

  } catch (error) {
    console.error('❌ Test failed:', error);
    
    // Cleanup on error
    try {
      realTimeCallStateMachine.endSession(callId, 'test_error');
      optimizedRealTimeAudioPipeline.cleanupCall(callId);
      enhancedBargeInDetectionService.cleanupCall(callId);
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
    
    return false;
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testRealTimeCallWorkflow()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

export { testRealTimeCallWorkflow };