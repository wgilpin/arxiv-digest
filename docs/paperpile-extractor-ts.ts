/**
 * Extracts text from a Paperpile PDF viewer page and converts it to Markdown format
 * This function must be run in the context of the Paperpile page (e.g., via console or extension)
 */

interface TextSpan {
  text: string;
  top: number;
  left: number;
  fontSize: number;
  fontFamily: string;
  fontWeight?: string;
}

interface TextLine {
  text: string;
  fontSize: number;
  isHeader: boolean;
  isBold: boolean;
}

/**
 * Extracts text from Paperpile PDF viewer and converts to Markdown
 * @param url - The Paperpile URL (used for validation and metadata)
 * @returns The extracted text in Markdown format
 */
async function extractPaperpileText(url: string): Promise<string> {
  // Validate URL
  if (!url.includes('paperpile.com/view/')) {
    throw new Error('Invalid Paperpile URL');
  }

  // Check if we're on the correct page
  if (!window.location.href.includes(url) && !url.includes(window.location.href)) {
    throw new Error('This function must be run on the Paperpile page. Navigate to: ' + url);
  }

  // Find the text layer
  const textLayer = document.querySelector('.textLayer') as HTMLElement;
  if (!textLayer) {
    throw new Error('No text layer found. Ensure the PDF is fully loaded.');
  }

  // Extract all text spans
  const spans = Array.from(textLayer.querySelectorAll('span[dir="ltr"]')) as HTMLSpanElement[];
  if (spans.length === 0) {
    throw new Error('No text spans found in the document.');
  }

  // Parse span information
  const textSpans: TextSpan[] = spans.map(span => {
    const style = span.style;
    return {
      text: span.textContent || '',
      top: parseFloat(style.top) || 0,
      left: parseFloat(style.left) || 0,
      fontSize: parseFloat(style.fontSize) || 12,
      fontFamily: style.fontFamily || '',
      fontWeight: style.fontWeight
    };
  });

  // Group spans into lines based on vertical position
  const lines = groupSpansIntoLines(textSpans);
  
  // Convert lines to Markdown
  const markdown = convertToMarkdown(lines);
  
  return markdown;
}

/**
 * Groups text spans into lines based on their vertical position
 */
function groupSpansIntoLines(spans: TextSpan[]): TextLine[] {
  const lines: TextLine[] = [];
  const lineThreshold = 5; // pixels difference to consider new line
  
  let currentLine: TextSpan[] = [];
  let lastTop: number | null = null;

  // Sort spans by top position, then by left position
  const sortedSpans = [...spans].sort((a, b) => {
    if (Math.abs(a.top - b.top) < lineThreshold) {
      return a.left - b.left;
    }
    return a.top - b.top;
  });

  sortedSpans.forEach(span => {
    // Check if this is a new line
    if (lastTop !== null && Math.abs(span.top - lastTop) > lineThreshold) {
      if (currentLine.length > 0) {
        lines.push(processLine(currentLine));
      }
      currentLine = [span];
    } else {
      currentLine.push(span);
    }
    lastTop = span.top;
  });

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push(processLine(currentLine));
  }

  return lines;
}

/**
 * Process a line of spans into a TextLine object
 */
function processLine(spans: TextSpan[]): TextLine {
  // Combine text from all spans in the line
  let text = spans.map(s => s.text).join('');
  
  // Determine line properties
  const avgFontSize = spans.reduce((sum, s) => sum + s.fontSize, 0) / spans.length;
  const isBold = spans.some(s => s.fontWeight === 'bold' || parseInt(s.fontWeight || '400') >= 700);
  const isHeader = avgFontSize > 14 || isBold;
  
  // Clean up mathematical formulas and spacing
  text = cleanupText(text);
  
  return {
    text,
    fontSize: avgFontSize,
    isHeader,
    isBold
  };
}

/**
 * Clean up extracted text
 */
function cleanupText(text: string): string {
  return text
    // Remove excessive spaces
    .replace(/\s+/g, ' ')
    // Fix common formula issues
    .replace(/(\w)\s+(\d)/g, '$1$2') // Remove space between letters and numbers in formulas
    .replace(/(\d)\s+(\w)/g, '$1$2')
    .replace(/([+\-*/=])\s+/g, '$1') // Remove spaces after operators
    .replace(/\s+([+\-*/=])/g, '$1') // Remove spaces before operators
    // Trim
    .trim();
}

/**
 * Convert lines to Markdown format
 */
function convertToMarkdown(lines: TextLine[]): string {
  const markdownLines: string[] = [];
  let lastWasEmpty = false;
  let inCodeBlock = false;
  let listLevel = 0;

  lines.forEach((line, index) => {
    const { text, isHeader, fontSize } = line;
    
    // Skip empty lines but track them for paragraph breaks
    if (!text || text.trim().length === 0) {
      if (!lastWasEmpty) {
        markdownLines.push('');
      }
      lastWasEmpty = true;
      return;
    }
    
    lastWasEmpty = false;
    
    // Detect and format different content types
    let formattedLine = text;
    
    // Headers (based on font size)
    if (isHeader && index < 10) { // Likely title or section header
      if (fontSize > 20) {
        formattedLine = `# ${text}`;
      } else if (fontSize > 16) {
        formattedLine = `## ${text}`;
      } else if (fontSize > 14) {
        formattedLine = `### ${text}`;
      }
    }
    // Bullet points
    else if (text.match(/^[•·▪▫◦‣⁃]\s*/)) {
      formattedLine = text.replace(/^[•·▪▫◦‣⁃]\s*/, '- ');
    }
    // Numbered lists
    else if (text.match(/^\d+\.\s+/)) {
      formattedLine = text;
    }
    // Code blocks (simple heuristic)
    else if (text.includes('{') || text.includes('}') || text.includes('function') || text.includes('class')) {
      if (!inCodeBlock) {
        markdownLines.push('```');
        inCodeBlock = true;
      }
      formattedLine = text;
    }
    // Mathematical formulas (inline)
    else if (text.match(/[∑∏∫∂∇±≈≠≤≥∈∉⊂⊃∪∩]/) || text.match(/\\[a-zA-Z]+/)) {
      formattedLine = `$${text}$`;
    }
    // References (common patterns)
    else if (text.match(/^\[\d+\]/) || text.match(/^References$/i)) {
      if (text.match(/^References$/i)) {
        formattedLine = `## ${text}`;
      }
    }
    
    // Close code block if needed
    if (inCodeBlock && !text.includes('{') && !text.includes('}')) {
      markdownLines.push('```');
      inCodeBlock = false;
    }
    
    markdownLines.push(formattedLine);
  });
  
  // Close any open code block
  if (inCodeBlock) {
    markdownLines.push('```');
  }
  
  // Post-process to clean up
  return postProcessMarkdown(markdownLines.join('\n'));
}

/**
 * Post-process the Markdown for final cleanup
 */
function postProcessMarkdown(markdown: string): string {
  return markdown
    // Normalize line breaks
    .replace(/\n{3,}/g, '\n\n')
    // Ensure headers have blank lines around them
    .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
    .replace(/(#{1,6}\s[^\n]+)\n([^\n])/g, '$1\n\n$2')
    // Fix list formatting
    .replace(/\n\n(-\s)/g, '\n$1')
    // Remove trailing spaces
    .replace(/ +$/gm, '')
    // Ensure document ends with newline
    .trim() + '\n';
}

/**
 * Helper function to copy text to clipboard
 */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    console.log('✅ Text copied to clipboard!');
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    // Fallback method
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    console.log('✅ Text copied to clipboard (fallback method)!');
  }
}

/**
 * Main function to run the extraction
 * Usage: Copy this entire code to console, then run:
 * extractAndCopy(window.location.href)
 */
async function extractAndCopy(url: string): Promise<string> {
  try {
    console.log('🔍 Extracting text from Paperpile PDF...');
    const markdown = await extractPaperpileText(url);
    
    console.log(`📄 Extracted ${markdown.length} characters`);
    console.log(`📝 ${markdown.split('\n').length} lines`);
    
    // Copy to clipboard
    await copyToClipboard(markdown);
    
    // Also return it
    console.log('\n--- EXTRACTED MARKDOWN ---\n');
    console.log(markdown);
    console.log('\n--- END ---\n');
    
    return markdown;
  } catch (error) {
    console.error('❌ Extraction failed:', error);
    throw error;
  }
}

// Export for use
export { extractPaperpileText, extractAndCopy };