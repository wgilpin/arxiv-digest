import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Debug script to examine ArXiv HTML structure for figures
 */
async function debugArxivFigures(arxivId: string) {
  try {
    console.log(`Fetching HTML for ArXiv paper: ${arxivId}`);
    
    let htmlUrl = `https://arxiv.org/html/${arxivId}v1`;
    let response;
    
    try {
      response = await axios.get(htmlUrl, { timeout: 30000 });
    } catch (error) {
      htmlUrl = `https://arxiv.org/html/${arxivId}`;
      response = await axios.get(htmlUrl, { timeout: 30000 });
    }
    
    console.log(`Successfully fetched HTML from: ${htmlUrl}`);
    console.log(`HTML content length: ${response.data.length}`);
    
    const $ = cheerio.load(response.data);
    
    // Look for figure elements
    console.log('\\n=== FIGURE ELEMENTS ===');
    $('figure').each((index, element) => {
      const $figure = $(element);
      const $img = $figure.find('img').first();
      const $caption = $figure.find('figcaption').first();
      
      console.log(`Figure ${index + 1}:`);
      console.log(`  - Has img: ${$img.length > 0}`);
      if ($img.length > 0) {
        console.log(`  - Image src: ${$img.attr('src')}`);
        console.log(`  - Image alt: ${$img.attr('alt')}`);
      }
      console.log(`  - Caption: ${$caption.text().trim().slice(0, 100)}...`);
      console.log('');
    });
    
    // Look for LaTeX figure environments
    console.log('\\n=== LATEX FIGURE ELEMENTS ===');
    $('.ltx_figure').each((index, element) => {
      const $figure = $(element);
      const $img = $figure.find('img').first();
      const $caption = $figure.find('.ltx_caption').first();
      
      console.log(`LaTeX Figure ${index + 1}:`);
      console.log(`  - Has img: ${$img.length > 0}`);
      if ($img.length > 0) {
        console.log(`  - Image src: ${$img.attr('src')}`);
        console.log(`  - Image alt: ${$img.attr('alt')}`);
      }
      console.log(`  - Caption: ${$caption.text().trim().slice(0, 100)}...`);
      console.log('');
    });
    
    // Look for any img tags
    console.log('\\n=== ALL IMG TAGS ===');
    $('img').each((index, element) => {
      const $img = $(element);
      console.log(`Image ${index + 1}:`);
      console.log(`  - src: ${$img.attr('src')}`);
      console.log(`  - alt: ${$img.attr('alt')}`);
      console.log(`  - parent: ${$img.parent().prop('tagName')}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error fetching or parsing HTML:', error);
  }
}

// Run with the problematic ArXiv ID
debugArxivFigures('2409.04701').catch(console.error);