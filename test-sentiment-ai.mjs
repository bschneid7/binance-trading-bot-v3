#!/usr/bin/env node
/**
 * Test script for AI Sentiment Analysis
 */

import 'dotenv/config';
import OpenAI from 'openai';

console.log('Testing AI Sentiment Analysis...\n');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Set (' + process.env.OPENAI_API_KEY.substring(0, 10) + '...)' : 'NOT SET');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const testHeadlines = [
  "Bitcoin drops below $87,000 as holiday trading volume decreases",
  "Ethereum faces selling pressure amid market uncertainty",
  "Solana institutional inflows continue despite price decline",
  "Crypto market sees $23.8B options expiry on December 26",
  "Fear and Greed Index hits extreme fear at 24"
];

const prompt = `Analyze the sentiment of these BTC cryptocurrency news headlines and provide:
1. A sentiment score from 0-100 (0=extremely bearish, 50=neutral, 100=extremely bullish)
2. A brief analysis (1-2 sentences)
3. Key factors affecting sentiment

Headlines:
${testHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Respond in JSON format:
{
  "score": <number 0-100>,
  "analysis": "<brief analysis>",
  "keyFactors": ["<factor1>", "<factor2>"],
  "confidence": <number 0-100>
}`;

try {
  console.log('\nSending request to OpenAI...');
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-nano',
    messages: [
      {
        role: 'system',
        content: 'You are a crypto market sentiment analyst. Analyze news headlines and provide objective sentiment scores. Be concise and data-driven.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 300,
  });
  
  console.log('\n✅ Response received!');
  console.log('\nRaw response:');
  console.log(response.choices[0].message.content);
  
  // Parse JSON
  const content = response.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  
  if (jsonMatch) {
    const result = JSON.parse(jsonMatch[0]);
    console.log('\n📊 Parsed Result:');
    console.log(`   Score: ${result.score}/100`);
    console.log(`   Analysis: ${result.analysis}`);
    console.log(`   Key Factors: ${result.keyFactors?.join(', ')}`);
    console.log(`   Confidence: ${result.confidence}%`);
  }
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  if (error.response) {
    console.error('Response status:', error.response.status);
    console.error('Response data:', error.response.data);
  }
}
