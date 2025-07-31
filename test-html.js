const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { ArxivService } = require('./dist/arxiv/arxiv.service');
const { FirebaseStorageService } = require('./dist/storage/storage.service');

async function testHtmlExtraction() {
  const app = await NestFactory.create(AppModule);
  const arxivService = app.get(ArxivService);
  const storageService = app.get(FirebaseStorageService);
  
  // Test with a different recent paper that likely has HTML: 2501.10582
  const testPaperId = '2501.10582';
  console.log(`Testing HTML extraction for ArXiv paper ${testPaperId}...`);
  
  try {
    // Clear any existing cache for this paper to test fresh extraction
    const paths = storageService.generateArxivPaths(testPaperId);
    try {
      if (await storageService.fileExists(paths.text)) {
        await storageService.deleteFile(paths.text);
        console.log('Cleared cached text file');
      }
      if (await storageService.fileExists(paths.html)) {
        await storageService.deleteFile(paths.html);
        console.log('Cleared cached HTML file');
      }
    } catch (error) {
      console.log('No cache to clear, proceeding with fresh extraction');
    }
    
    // Test with the paper
    const paperText = await arxivService.getPaperText(testPaperId);
    
    console.log('Paper text length:', paperText.length);
    console.log('First 500 characters:');
    console.log(paperText.substring(0, 500));
    console.log('...\n');
    
    if (paperText.includes('Unable to extract')) {
      console.log('❌ Failed to extract text from the paper');
    } else {
      console.log('✅ Successfully extracted text from the paper');
    }
    
  } catch (error) {
    console.error('Error during testing:', error);
  }
  
  await app.close();
}

testHtmlExtraction().then(() => {
  console.log('Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});