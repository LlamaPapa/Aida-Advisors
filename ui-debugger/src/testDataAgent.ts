/**
 * Test Data Agent
 *
 * Generates test data on demand for UI testing:
 * - CSV files with realistic data
 * - Fake users, products, transactions
 * - Mock images and files
 * - API mock responses
 *
 * Uses Claude to understand what data is needed and generate it.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

export interface TestDataRequest {
  type: 'csv' | 'json' | 'users' | 'products' | 'image' | 'file' | 'custom';
  description: string;
  count?: number;
  schema?: Record<string, string>;
  outputPath?: string;
}

export interface GeneratedTestData {
  type: string;
  path: string;
  preview: string;
  rowCount?: number;
}

export interface TestDataContext {
  projectRoot: string;
  testPlan?: string;
  uiComponents?: string[];
  formFields?: string[];
}

let anthropicClient: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (!anthropicClient) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY required');
    anthropicClient = new Anthropic({ apiKey: key });
  }
  return anthropicClient;
}

/**
 * Analyze what test data is needed based on test plan and UI
 */
export async function analyzeDataNeeds(
  context: TestDataContext,
  apiKey?: string
): Promise<TestDataRequest[]> {
  const client = getClient(apiKey);

  const prompt = `You are a test data engineer. Analyze this test context and determine what test data files are needed.

PROJECT: ${context.projectRoot}

TEST PLAN:
${context.testPlan || 'General UI testing'}

UI COMPONENTS:
${context.uiComponents?.join(', ') || 'Unknown'}

FORM FIELDS DETECTED:
${context.formFields?.join(', ') || 'Unknown'}

Based on this, what test data would be useful? Consider:
1. File uploads (CSV, images, documents)
2. Form data (users, addresses, products)
3. Edge cases (empty data, large datasets, special characters)

Respond in JSON:
{
  "dataNeeds": [
    {
      "type": "csv|json|users|products|image|file|custom",
      "description": "What this data is for",
      "count": 10,
      "schema": {
        "field1": "type (string|number|email|date|phone|address|name|id)",
        "field2": "type"
      }
    }
  ]
}

Be practical - only suggest 2-5 data files that would actually be useful for testing.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return result.dataNeeds || [];
    }
  } catch (error) {
    console.error('Failed to analyze data needs:', error);
  }

  // Default: suggest basic user data
  return [{
    type: 'users',
    description: 'Basic test users for form testing',
    count: 5,
    schema: {
      name: 'name',
      email: 'email',
      phone: 'phone',
    },
  }];
}

/**
 * Generate fake data based on field type
 */
function generateFieldValue(fieldType: string, index: number): string | number {
  const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Taylor'];
  const domains = ['example.com', 'test.org', 'demo.net', 'sample.io'];
  const streets = ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Pine Rd', 'Elm Way'];
  const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Seattle'];
  const products = ['Widget', 'Gadget', 'Doohickey', 'Thingamajig', 'Gizmo', 'Contraption'];
  const adjectives = ['Premium', 'Basic', 'Pro', 'Ultra', 'Deluxe', 'Standard'];

  switch (fieldType.toLowerCase()) {
    case 'name':
    case 'fullname':
    case 'full_name':
      return `${firstNames[index % firstNames.length]} ${lastNames[index % lastNames.length]}`;

    case 'firstname':
    case 'first_name':
      return firstNames[index % firstNames.length];

    case 'lastname':
    case 'last_name':
      return lastNames[index % lastNames.length];

    case 'email':
      return `user${index + 1}@${domains[index % domains.length]}`;

    case 'phone':
    case 'phonenumber':
    case 'phone_number':
      return `+1-555-${String(100 + index).padStart(3, '0')}-${String(1000 + index * 111).slice(0, 4)}`;

    case 'address':
    case 'street':
      return `${100 + index * 10} ${streets[index % streets.length]}`;

    case 'city':
      return cities[index % cities.length];

    case 'zip':
    case 'zipcode':
    case 'zip_code':
    case 'postal':
      return String(10000 + index * 1111).slice(0, 5);

    case 'id':
    case 'uuid':
      return `id-${String(index + 1).padStart(6, '0')}`;

    case 'date':
    case 'created':
    case 'createdat':
    case 'created_at':
      const date = new Date();
      date.setDate(date.getDate() - index);
      return date.toISOString().split('T')[0];

    case 'datetime':
    case 'timestamp':
      const dt = new Date();
      dt.setHours(dt.getHours() - index);
      return dt.toISOString();

    case 'number':
    case 'amount':
    case 'quantity':
    case 'count':
      return Math.floor(Math.random() * 100) + 1;

    case 'price':
    case 'cost':
    case 'total':
      return Number((Math.random() * 1000).toFixed(2));

    case 'boolean':
    case 'active':
    case 'enabled':
      return index % 2 === 0 ? 'true' : 'false';

    case 'status':
      const statuses = ['active', 'pending', 'completed', 'cancelled'];
      return statuses[index % statuses.length];

    case 'product':
    case 'productname':
    case 'product_name':
      return `${adjectives[index % adjectives.length]} ${products[index % products.length]}`;

    case 'description':
    case 'desc':
      return `This is a test description for item ${index + 1}. It contains sample text for testing purposes.`;

    case 'url':
    case 'website':
      return `https://example${index + 1}.com`;

    case 'image':
    case 'imageurl':
    case 'image_url':
    case 'avatar':
      return `https://picsum.photos/seed/${index + 1}/200/200`;

    case 'company':
    case 'organization':
      const companies = ['Acme Corp', 'Globex Inc', 'Initech', 'Umbrella LLC', 'Stark Industries'];
      return companies[index % companies.length];

    case 'country':
      const countries = ['USA', 'Canada', 'UK', 'Germany', 'France', 'Japan', 'Australia'];
      return countries[index % countries.length];

    case 'currency':
      const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD'];
      return currencies[index % currencies.length];

    case 'category':
    case 'type':
      const categories = ['Electronics', 'Clothing', 'Food', 'Services', 'Software'];
      return categories[index % categories.length];

    case 'rating':
    case 'score':
      return Number((Math.random() * 4 + 1).toFixed(1));

    case 'percentage':
    case 'percent':
      return Math.floor(Math.random() * 100);

    default:
      // Generic string
      return `${fieldType}_${index + 1}`;
  }
}

/**
 * Generate CSV data
 */
export function generateCSV(
  schema: Record<string, string>,
  count: number = 10
): string {
  const headers = Object.keys(schema);
  const rows: string[] = [headers.join(',')];

  for (let i = 0; i < count; i++) {
    const row = headers.map(field => {
      const value = generateFieldValue(schema[field], i);
      // Quote strings that might contain commas
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return String(value);
    });
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

/**
 * Generate JSON data
 */
export function generateJSON(
  schema: Record<string, string>,
  count: number = 10
): object[] {
  const data: object[] = [];

  for (let i = 0; i < count; i++) {
    const row: Record<string, string | number> = {};
    for (const [field, type] of Object.entries(schema)) {
      row[field] = generateFieldValue(type, i);
    }
    data.push(row);
  }

  return data;
}

/**
 * Generate test users
 */
export function generateUsers(count: number = 5): object[] {
  return generateJSON({
    id: 'id',
    firstName: 'firstname',
    lastName: 'lastname',
    email: 'email',
    phone: 'phone',
    address: 'address',
    city: 'city',
    country: 'country',
    createdAt: 'datetime',
    active: 'boolean',
  }, count);
}

/**
 * Generate test products
 */
export function generateProducts(count: number = 10): object[] {
  return generateJSON({
    id: 'id',
    name: 'product',
    description: 'description',
    price: 'price',
    category: 'category',
    stock: 'quantity',
    imageUrl: 'imageurl',
    rating: 'rating',
    createdAt: 'date',
  }, count);
}

/**
 * Generate a placeholder image (returns data URL or file path)
 */
export function generatePlaceholderImage(
  width: number = 200,
  height: number = 200,
  text: string = 'Test',
  outputPath?: string
): string {
  // SVG placeholder
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#cccccc"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
          font-family="Arial" font-size="${Math.min(width, height) / 5}" fill="#666666">
      ${text}
    </text>
  </svg>`;

  if (outputPath) {
    fs.writeFileSync(outputPath, svg);
    return outputPath;
  }

  // Return as data URL
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * Generate a mock file
 */
export function generateMockFile(
  filename: string,
  content: string,
  outputDir: string
): string {
  const filePath = path.join(outputDir, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * Generate test data based on request
 */
export async function generateTestData(
  request: TestDataRequest,
  outputDir: string,
  apiKey?: string
): Promise<GeneratedTestData> {
  const count = request.count || 10;

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  switch (request.type) {
    case 'csv': {
      const schema = request.schema || {
        id: 'id',
        name: 'name',
        email: 'email',
        value: 'number',
      };
      const csv = generateCSV(schema, count);
      const filename = request.outputPath || `test-data-${Date.now()}.csv`;
      const filePath = path.join(outputDir, filename);
      fs.writeFileSync(filePath, csv);

      return {
        type: 'csv',
        path: filePath,
        preview: csv.split('\n').slice(0, 4).join('\n') + '\n...',
        rowCount: count,
      };
    }

    case 'json': {
      const schema = request.schema || {
        id: 'id',
        name: 'name',
        value: 'number',
      };
      const data = generateJSON(schema, count);
      const filename = request.outputPath || `test-data-${Date.now()}.json`;
      const filePath = path.join(outputDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

      return {
        type: 'json',
        path: filePath,
        preview: JSON.stringify(data.slice(0, 2), null, 2) + '\n...',
        rowCount: count,
      };
    }

    case 'users': {
      const users = generateUsers(count);
      const filename = request.outputPath || `test-users-${Date.now()}.json`;
      const filePath = path.join(outputDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(users, null, 2));

      return {
        type: 'users',
        path: filePath,
        preview: JSON.stringify(users.slice(0, 2), null, 2) + '\n...',
        rowCount: count,
      };
    }

    case 'products': {
      const products = generateProducts(count);
      const filename = request.outputPath || `test-products-${Date.now()}.json`;
      const filePath = path.join(outputDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(products, null, 2));

      return {
        type: 'products',
        path: filePath,
        preview: JSON.stringify(products.slice(0, 2), null, 2) + '\n...',
        rowCount: count,
      };
    }

    case 'image': {
      const filename = request.outputPath || `test-image-${Date.now()}.svg`;
      const filePath = path.join(outputDir, filename);
      generatePlaceholderImage(200, 200, 'Test', filePath);

      return {
        type: 'image',
        path: filePath,
        preview: `SVG placeholder image (200x200)`,
      };
    }

    case 'file': {
      const filename = request.outputPath || `test-file-${Date.now()}.txt`;
      const content = `Test file content\n${request.description}\nGenerated at: ${new Date().toISOString()}`;
      const filePath = generateMockFile(filename, content, outputDir);

      return {
        type: 'file',
        path: filePath,
        preview: content.slice(0, 100),
      };
    }

    case 'custom': {
      // Use Claude to generate custom data
      const client = getClient(apiKey);

      const prompt = `Generate test data based on this description:
${request.description}

Count: ${count}

Respond with valid JSON array only, no explanation:`;

      try {
        const response = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content.find(b => b.type === 'text')?.text || '[]';
        const jsonMatch = text.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          const filename = request.outputPath || `custom-data-${Date.now()}.json`;
          const filePath = path.join(outputDir, filename);
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

          return {
            type: 'custom',
            path: filePath,
            preview: JSON.stringify(data.slice(0, 2), null, 2) + '\n...',
            rowCount: data.length,
          };
        }
      } catch (error) {
        console.error('Custom data generation failed:', error);
      }

      // Fallback
      return {
        type: 'custom',
        path: '',
        preview: 'Generation failed',
      };
    }

    default:
      throw new Error(`Unknown data type: ${request.type}`);
  }
}

/**
 * Generate all needed test data for a project
 */
export async function generateAllTestData(
  context: TestDataContext,
  outputDir: string,
  apiKey?: string
): Promise<GeneratedTestData[]> {
  // Analyze what's needed
  const needs = await analyzeDataNeeds(context, apiKey);

  console.log(`Generating ${needs.length} test data files...`);

  const results: GeneratedTestData[] = [];

  for (const need of needs) {
    try {
      console.log(`  - ${need.type}: ${need.description}`);
      const result = await generateTestData(need, outputDir, apiKey);
      results.push(result);
    } catch (error) {
      console.error(`  Failed to generate ${need.type}:`, error);
    }
  }

  return results;
}

/**
 * Quick helper to generate specific data types
 */
export const TestData = {
  csv: (schema: Record<string, string>, count?: number, outputPath?: string) =>
    generateTestData({ type: 'csv', description: 'CSV data', schema, count, outputPath }, '.'),

  users: (count?: number, outputPath?: string) =>
    generateTestData({ type: 'users', description: 'Test users', count, outputPath }, '.'),

  products: (count?: number, outputPath?: string) =>
    generateTestData({ type: 'products', description: 'Test products', count, outputPath }, '.'),

  image: (outputPath?: string) =>
    generateTestData({ type: 'image', description: 'Placeholder image', outputPath }, '.'),
};
