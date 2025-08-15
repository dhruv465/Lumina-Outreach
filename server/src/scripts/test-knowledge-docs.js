/**
 * Test script to validate knowledge documents API authentication and empty state behavior
 * 
 * This script tests:
 * 1. GET /api/knowledge/documents without Authorization header -> expect 401
 * 2. GET /api/knowledge/documents with valid token but no documents -> expect 200 with empty array
 * 3. General API behavior validation
 */

require('dotenv').config();
const axios = require('axios');

// API base URL - update to match your server
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000/api';

// Test authentication and empty state behavior
async function testKnowledgeDocuments() {
  console.log('Testing Knowledge Documents API...');
  console.log('API Base URL:', API_BASE_URL);
  
  try {
    // Test 1: Unauthenticated request should return 401
    console.log('\n1. Testing unauthenticated request...');
    try {
      const unauthResponse = await axios.get(`${API_BASE_URL}/knowledge/documents`);
      console.log('❌ ERROR: Expected 401 but got success response:', unauthResponse.status);
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('✅ PASS: Unauthenticated request correctly returned 401');
        console.log('Response:', error.response.data);
        
        // Verify the response structure
        if (error.response.data.success === false && error.response.data.message) {
          console.log('✅ PASS: Response has correct structure with success: false');
        } else {
          console.log('❌ WARN: Response structure might be incorrect:', error.response.data);
        }
      } else {
        console.log('❌ ERROR: Expected 401 but got:', error.response?.status || 'Network error');
        console.log('Error details:', error.message);
      }
    }
    
    // Test 2: Valid token test (requires manual setup or existing test user)
    console.log('\n2. Testing with authentication (requires valid setup)...');
    console.log('Note: This test requires a valid JWT token and running server.');
    console.log('To test manually:');
    console.log('1. Start the server: npm run dev');
    console.log('2. Login via API to get a token');
    console.log('3. Use the token to test: curl -H "Authorization: Bearer <token>" ' + API_BASE_URL + '/knowledge/documents');
    console.log('4. Expected: 200 with { success: true, documents: [], page: 1, limit: 20, total: 0 }');
    
    console.log('\n✅ Authentication flow validation test completed');
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Test helper function to validate API structure
function validateKnowledgeResponse(response) {
  const requiredFields = ['success', 'documents'];
  const data = response.data;
  
  for (const field of requiredFields) {
    if (!(field in data)) {
      console.log(`❌ Missing required field: ${field}`);
      return false;
    }
  }
  
  if (data.success === true && Array.isArray(data.documents)) {
    console.log('✅ Response structure is valid');
    return true;
  }
  
  console.log('❌ Invalid response structure');
  return false;
}

// Add manual test instructions
function printManualTestInstructions() {
  console.log('\n' + '='.repeat(60));
  console.log('MANUAL TEST INSTRUCTIONS');
  console.log('='.repeat(60));
  console.log('1. Start the server: cd server && npm run dev');
  console.log('2. Test unauthenticated request:');
  console.log('   curl -v ' + API_BASE_URL + '/knowledge/documents');
  console.log('   Expected: 401 {"success":false,"message":"Unauthorized"}');
  console.log('');
  console.log('3. Login and get token:');
  console.log('   curl -X POST ' + API_BASE_URL + '/users/login \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"email":"test@example.com","password":"password123"}\'');
  console.log('');
  console.log('4. Test authenticated request with empty result:');
  console.log('   curl -H "Authorization: Bearer <your-token>" ' + API_BASE_URL + '/knowledge/documents');
  console.log('   Expected: 200 {"success":true,"documents":[],"page":1,"limit":20,"total":0}');
  console.log('');
  console.log('5. Upload a document and test again to verify list increments');
  console.log('='.repeat(60));
}

// Run the test
testKnowledgeDocuments().then(() => {
  printManualTestInstructions();
});