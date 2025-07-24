/**
 * Test script to verify the login and authentication flow
 * 
 * This script attempts to login and make an authenticated request
 * to verify that authentication is working correctly
 */

require('dotenv').config();
const axios = require('axios');

// API base URL - update to match your server
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000/api';

// Test credentials - replace with actual test credentials
const TEST_EMAIL = 'test@example.com';  
const TEST_PASSWORD = 'password123';    

// Test authentication flow
async function testAuthFlow() {
  try {
    console.log('Testing authentication flow...');
    console.log('API Base URL:', API_BASE_URL);
    
    // Step 1: Attempt login
    console.log('\n1. Attempting login...');
    const loginResponse = await axios.post(`${API_BASE_URL}/users/login`, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    });
    
    if (loginResponse.status !== 200) {
      throw new Error(`Login failed with status ${loginResponse.status}`);
    }
    
    const { token, _id, name, email, role } = loginResponse.data;
    console.log(`Login successful for user: ${name} (${email})`);
    console.log(`User ID: ${_id}`);
    console.log(`User Role: ${role}`);
    console.log(`Token received: ${token.substring(0, 20)}...`);
    
    // Step 2: Make an authenticated request to get user profile
    console.log('\n2. Testing authenticated request...');
    const profileResponse = await axios.get(`${API_BASE_URL}/users/profile`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    if (profileResponse.status !== 200) {
      throw new Error(`Profile request failed with status ${profileResponse.status}`);
    }
    
    console.log('Profile request successful');
    console.log('Profile data:', profileResponse.data);
    
    // Step 3: Test another authenticated endpoint
    console.log('\n3. Testing another authenticated endpoint...');
    try {
      const anotherResponse = await axios.get(`${API_BASE_URL}/dashboard/summary`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      console.log('Second authenticated request successful');
      console.log('Data:', anotherResponse.data);
    } catch (error) {
      console.log('Second authenticated request error:', error.message);
      if (error.response) {
        console.log('Status:', error.response.status);
        console.log('Response:', error.response.data);
      }
    }
    
    console.log('\nAuthentication flow test completed successfully');
  } catch (error) {
    console.error('\nError during authentication test:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    }
  }
}

// Run the test
testAuthFlow();
