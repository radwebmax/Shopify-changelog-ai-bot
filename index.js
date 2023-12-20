const axios = require('axios');
const cheerio = require('cheerio');
const { WebClient } = require('@slack/web-api');
const cron = require('node-cron');
require('dotenv').config();
const { OpenAI } = require('openai');


const token = process.env.SLACK_TOKEN ; // Replace with your Slack bot token
const slackClient = new WebClient(token);
const slackChannel = process.env.CHANNEL_ID; // Replace with your Slack channel ID
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
  
async function summarizeWebpage(url) {
    try {
      // Fetch the content of the webpage
      const response = await axios.get(url);
      const htmlContent = response.data;
      // Extract relevant text from HTML
      const textToSummarize = extractRelevantText(htmlContent);
      
      // Send the text to the OpenAI API to summarize
      const summaryResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
            { role: "system", content: "You are a helpful Shopify Support assistant." },
            { role: "user", content: `Summarize this for me: ${textToSummarize}. If there're any Learn More link - please include it as well at the end` }
        ],
        max_tokens: 200,
      });
  
      console.log(summaryResponse.choices[0])
      return cleanUpResponse(summaryResponse.choices[0].message.content.trim());
    } catch (error) {
      console.error('Error summarizing webpage:', error);
      return null;
    }
}

function extractRelevantText(htmlContent) {
    const $ = cheerio.load(htmlContent);
    
    // Assume the relevant content is within a container with the class '.article-content'.
    // You will need to adjust the selector to match the actual content container on the Shopify changelog page.
    const contentContainer = $('.post__content');
  
    // Extract the text from the content container. If there are multiple paragraphs, concatenate them.
    let extractedText = '';
    contentContainer.find('p').each((index, element) => {
      const paragraph = $(element).text().trim();
      extractedText += paragraph + '\n\n'; // Add two newlines to separate paragraphs.
    });
  
    return extractedText.trim(); // Remove any leading/trailing whitespace
}

function cleanUpResponse(text) {
    // This will remove the hyperlink placeholders like '[Learn more about text lists]'
    return text.replace(/\[.*?\]/g, '');
}
  
async function checkShopifyChangelog() {
    try {
      const response = await axios.get('https://changelog.shopify.com/');
      const $ = cheerio.load(response.data);

      // Assuming the structure of the page is consistent with the image you've uploaded
      const updateElement = $('.changelog-post').first(); // You'll need to determine the correct selector

      const date = updateElement.find('.post-block__date span').text().trim();
      const title = updateElement.find('.post-block__link').text().trim();
      const description = updateElement.find('.post__content').text().trim();
      const type = updateElement.find('.status-tag.feature').text().trim() + ' ' + updateElement.find('.status-tag.feature + .text-minor').text().trim();
      
      // Assuming the title contains an 'a' tag with the href attribute
      const link = updateElement.find('.post-block__link').attr('href');

      // If the link is relative, prepend the base URL
      const absoluteLink = link.startsWith('http') ? link : `https://changelog.shopify.com${link}`;

      const aiDescription = await summarizeWebpage(absoluteLink).then(summary => {
        return summary != null ? summary : 'No OpenAi overview';
      });
      // Create the message in the desired format
      const message = `🔑 Title: *${title}*\n📅 Date: ${date}\n❓Overview: ${description}\n🗨️ Description: ${aiDescription}\n\n🌀 Type: ${type}\n🔗 Link: ${absoluteLink}`;

      return { message, id: title.slice(0, 10) }; // Return the message and a unique ID from the title
    } catch (error) {
      console.error('Error fetching Shopify changelog:', error);
      return null;
    }
}

async function getLastMessageFromSlack() {
    try {
      const result = await slackClient.conversations.history({
        channel: slackChannel,
        limit: 1
      });
  
      if (result.messages && result.messages.length > 0) {
        return result.messages[0].text;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error fetching last message from Slack:', error);
      return null;
    }
}
  
function extractIdFromUpdate(update) {
    return update.slice(0, 10); // Get first 10 characters as ID
}
  

async function sendMessageToSlack(message) {
    try {
      await slackClient.chat.postMessage({
        channel: slackChannel,
        text: message,
      });
    } catch (error) {
      console.error('Error sending message to Slack:', error);
    }
}

// Immediately check and send the update when the script starts
async function init() {
    const latestUpdate = await checkShopifyChangelog();
    if (latestUpdate) {
        const lastMessage = await getLastMessageFromSlack();
        if (!lastMessage || !lastMessage.includes(latestUpdate.id)) {
            await sendMessageToSlack(latestUpdate.message);
        }else {
            console.log(`Message with ID ${latestUpdate.id} already exists in Slack channel.`);
        }
    }
}

// Schedule to run every 12 hours
// cron.schedule('0 0 */12 * *', async () => {
//     const latestUpdate = await checkShopifyChangelog();
//     if (latestUpdate) {
//         const lastMessage = await getLastMessageFromSlack();
//         if (!lastMessage || !lastMessage.includes(latestUpdate.id)) {
//             await sendMessageToSlack(latestUpdate.message);
//         }else {
//             console.log(`Message with ID ${latestUpdate.id} already exists in Slack channel.`);
//         }
//     }
// });

// Start the initial check
init();

