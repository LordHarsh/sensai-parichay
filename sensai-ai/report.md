# SENSAI Report Generation System Documentation

## Overview

The SENSAI Report Generation System provides comprehensive exam performance analysis through AI-powered evaluation and professional PDF report generation. The system generates detailed, structured reports with interactive charts, multi-dimensional assessments, and personalized learning recommendations.

## Architecture

### Backend API: `/api/exam/generate-report`

**File:** `/src/api/routes/exam.py`

**Endpoint:** `POST /api/exam/generate-report`

**Dependencies:**
- `weasyprint` - PDF generation
- `jinja2` - HTML templating
- `matplotlib` - Chart generation
- `openai` - AI evaluation
- `numpy` - Data processing

## API Structure

### Request Model

```python
class ReportGenerationRequest(BaseModel):
    exam_id: str
    session_id: str
    report_type: str = "comprehensive"  # comprehensive, summary, detailed
    include_analytics: bool = True
    include_questions: bool = True
    include_video_info: bool = True
```

### Response
- **Content-Type:** `application/pdf`
- **File Download:** Automatically triggers download with filename format: `SENSAI_Report_{exam_title}_{student_name}_{timestamp}.pdf`

## Core Components

### 1. AI Evaluation System

**Function:** `generate_ai_summaries()`

**Purpose:** Generates structured JSON evaluation using ChatGPT API instead of simple paragraph summaries.

**AI Model:** `gpt-4o-mini`

**Structured Output Format:**
```json
{
  "overall_performance": {
    "grade_level": "A/B/C/D/F",
    "performance_category": "Excellent/Good/Satisfactory/Needs Improvement/Poor",
    "strengths": ["strength1", "strength2", "strength3"],
    "weaknesses": ["weakness1", "weakness2", "weakness3"],
    "time_efficiency": "Excellent/Good/Average/Poor",
    "completion_rate": 95.5
  },
  "question_analysis": [
    {
      "question_number": 1,
      "status": "correct/incorrect/partial",
      "criteria_scores": {
        "accuracy": 85,
        "completeness": 90,
        "clarity": 80,
        "depth": 75
      },
      "feedback": "Detailed feedback for this question",
      "improvement_tips": ["tip1", "tip2"],
      "difficulty_level": "Easy/Medium/Hard",
      "time_spent_estimate": "Appropriate/Too Fast/Too Slow"
    }
  ],
  "skill_assessment": {
    "knowledge_areas": [
      {
        "area": "Conceptual Understanding",
        "score": 82,
        "level": "Proficient",
        "evidence": ["specific examples"]
      }
    ],
    "cognitive_skills": {
      "critical_thinking": 80,
      "analytical_reasoning": 75,
      "application": 85,
      "synthesis": 70
    }
  },
  "learning_recommendations": {
    "immediate_actions": [
      {
        "priority": "High/Medium/Low",
        "action": "Specific action to take",
        "timeline": "1-2 weeks"
      }
    ],
    "study_plan": {
      "focus_areas": ["area1", "area2"],
      "recommended_resources": ["resource1", "resource2"],
      "practice_exercises": ["exercise1", "exercise2"]
    },
    "next_steps": ["step1", "step2", "step3"]
  },
  "performance_metrics": {
    "accuracy_by_type": {
      "multiple_choice": 85,
      "short_answer": 70,
      "essay": 60
    },
    "time_distribution": {
      "planning": 10,
      "execution": 75,
      "review": 15
    },
    "confidence_indicators": {
      "certainty_level": 75,
      "revision_frequency": "Low/Medium/High"
    }
  }
}
```

### 2. Chart Generation System

**Function:** `generate_charts()`

**Purpose:** Creates base64-encoded charts embedded in PDF

**Chart Types:**

1. **Cognitive Skills Pie Chart**
   - Shows distribution of critical thinking, analytical reasoning, application, synthesis
   - Color-coded with professional palette

2. **Question Analysis Bar Chart**
   - Accuracy vs Completeness scores per question
   - Dual-bar chart with value labels

3. **Knowledge Areas Radar Chart**
   - Multi-dimensional skill mapping
   - Polar projection showing proficiency across areas

4. **Completion Gauge Chart**
   - Semi-circular gauge showing completion rate
   - Color-coded: Green (80%+), Orange (60-80%), Red (<60%)

**Technical Implementation:**
```python
# Set non-interactive backend for server environments
matplotlib.use('Agg')

# Generate chart and convert to base64
buffer = BytesIO()
plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
buffer.seek(0)
chart_base64 = base64.b64encode(buffer.getvalue()).decode()
plt.close()
```

### 3. PDF Generation System

**Function:** `create_pdf_report()`

**Template Engine:** Jinja2 with WeasyPrint

**Design Features:**
- Professional gradient headers with animation effects
- Responsive 2-column grid layouts
- Color-coded performance sections
- Interactive skill bars with progression indicators
- Priority-coded recommendation boxes
- Chart integration with base64 embedding

### 4. Fallback System

**Function:** `generate_fallback_evaluation()`

**Purpose:** Provides structured evaluation when AI API fails

**Features:**
- Basic metric calculations
- Rule-based grade assignment
- Template-based feedback generation
- Consistent JSON structure matching AI output

## Frontend Integration

### File: `/src/app/exam/[examId]/results/[sessionId]/page.tsx`

### Generate Report Button

**Location:** Action buttons section at bottom of exam results page

**Implementation:**
```typescript
const [generatingReport, setGeneratingReport] = useState(false);

const generateReport = async () => {
  try {
    setGeneratingReport(true);
    
    const response = await fetch(`http://localhost:8000/api/exam/generate-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': session?.user?.id || session?.user?.email || '',
      },
      body: JSON.stringify({
        exam_id: examId,
        session_id: sessionId,
        report_type: 'comprehensive',
        include_analytics: true,
        include_questions: true,
        include_video_info: true
      })
    });

    // Create blob and trigger download
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SENSAI_Report_${results?.exam_title}_${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
  } catch (error) {
    alert(`Failed to generate report: ${error.message}`);
  } finally {
    setGeneratingReport(false);
  }
};
```

**UI Components:**
- Loading spinner during generation
- Disabled state during processing
- Error handling with user feedback
- Automatic file download on completion

## Evaluation Criteria System

### Multi-Dimensional Assessment

**1. Question-Level Criteria (0-100% each):**
- **Accuracy:** Correctness of the answer
- **Completeness:** How fully the question was answered
- **Clarity:** How clear and understandable the response is
- **Depth:** Level of detail and insight demonstrated

**2. Overall Performance Categories:**
- **Grade Levels:** A, B, C, D, F
- **Performance Categories:** Excellent, Good, Satisfactory, Needs Improvement, Poor
- **Time Efficiency:** Excellent, Good, Average, Poor

**3. Skill Assessment Areas:**
- **Knowledge Areas:** Conceptual Understanding, Problem Solving, Application
- **Cognitive Skills:** Critical Thinking, Analytical Reasoning, Application, Synthesis
- **Proficiency Levels:** Expert, Proficient, Developing, Beginning

**4. Learning Recommendations:**
- **Priority Levels:** High, Medium, Low
- **Timelines:** 1 week, 2 weeks, 1 month
- **Resource Types:** Textbooks, Practice Tests, Tutorials, Study Groups

## PDF Design System

### Color Palette

**Grade-Based Gradients:**
- **A Grade (90%+):** `linear-gradient(135deg, #059669 0%, #10b981 100%)` - Green
- **B Grade (80-89%):** `linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)` - Blue
- **C Grade (70-79%):** `linear-gradient(135deg, #d97706 0%, #f59e0b 100%)` - Orange
- **D Grade (60-69%):** `linear-gradient(135deg, #dc2626 0%, #ef4444 100%)` - Red
- **F Grade (<60%):** `linear-gradient(135deg, #7c2d12 0%, #dc2626 100%)` - Dark Red

**Priority Colors:**
- **High Priority:** `#dc2626` - Red border
- **Medium Priority:** `#d97706` - Orange border  
- **Low Priority:** `#059669` - Green border

### Typography

- **Primary Font:** 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif
- **Header Sizes:** 32px (main title), 22px (section headers), 20px (subsections)
- **Body Text:** 12px with 1.5 line height
- **Color Scheme:** #2c3e50 (primary text), #1e40af (headers), #64748b (secondary)

### Layout Structure

**Page Setup:**
- **Size:** A4 (210mm × 297mm)
- **Margins:** 0.75 inches on all sides
- **Header/Footer:** Automatic page numbering

**Grid Systems:**
- **Overview Grid:** 2x2 layout for exam information
- **Performance Grid:** 2-column layout for detailed sections
- **Criteria Grid:** 4-column layout for scoring metrics
- **Chart Containers:** Full-width with center alignment

### Responsive Design

**Container Constraints:**
```css
.exam-overview {
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 15px;
  max-width: 100%;
}

.overview-item {
  min-width: 0; /* Allows flex items to shrink */
  word-wrap: break-word;
  overflow-wrap: break-word;
}
```

## Security & Permissions

### Access Control

**Authorization Rules:**
- **Students:** Can generate reports for their own exam sessions
- **Teachers:** Can generate reports for any session in exams they created
- **Verification:** User ID matching against session user_id or exam created_by

**Data Privacy:**
- **Analytics Data:** Only included for exam creators (teachers)
- **User Information:** Sanitized display names used
- **Session Data:** Full access only for authorized users

## Error Handling

### AI API Failures

**Fallback Strategy:**
1. Attempt OpenAI API call with structured prompt
2. Parse JSON response with error handling
3. If parsing fails, use `generate_fallback_evaluation()`
4. Maintain consistent output structure regardless of source

### Chart Generation Failures

**Graceful Degradation:**
- Chart generation wrapped in try-catch blocks
- Returns empty dict if chart creation fails
- Report continues without charts rather than failing entirely
- Error logging for debugging purposes

### PDF Generation Failures

**Common Issues:**
- **Template Rendering Errors:** Jinja2 syntax validation
- **WeasyPrint Issues:** CSS compatibility checks
- **Font Loading Problems:** Fallback font specifications
- **Memory Limitations:** Temporary file cleanup

## Performance Optimizations

### Chart Generation

- **Non-Interactive Backend:** `matplotlib.use('Agg')`
- **Memory Management:** Explicit `plt.close()` after each chart
- **Image Compression:** PNG format with 300 DPI for quality/size balance
- **Base64 Encoding:** Direct embedding to avoid file system dependencies

### PDF Generation

- **Template Caching:** Jinja2 template compilation optimization
- **Temporary Files:** Automatic cleanup with `tempfile.NamedTemporaryFile`
- **CSS Optimization:** Inline styles to reduce external dependencies
- **Image Optimization:** Base64 embedding reduces HTTP requests

## Deployment Considerations

### Dependencies Installation

```bash
pip install weasyprint jinja2 matplotlib openai numpy reportlab
```

### Environment Variables

```env
OPENAI_API_KEY=your_openai_api_key_here
```

### Server Configuration

**Memory Requirements:**
- **Chart Generation:** ~50MB per report (matplotlib)
- **PDF Generation:** ~30MB per report (weasyprint)
- **AI API Calls:** Minimal memory footprint

**Processing Time:**
- **AI Evaluation:** 3-5 seconds (depends on OpenAI API)
- **Chart Generation:** 2-3 seconds
- **PDF Creation:** 1-2 seconds
- **Total:** ~6-10 seconds per report

## Usage Examples

### Basic Report Generation

```typescript
// Frontend call
const reportData = {
  exam_id: "ca7cf870-56a0-4e03-b6b1-7ccf0a0b1bd4",
  session_id: "ca7cf870-56a0-4e03-b6b1-7ccf0a0b1bd4_2_1754607321",
  report_type: "comprehensive",
  include_analytics: true,
  include_questions: true,
  include_video_info: true
};

const response = await fetch('/api/exam/generate-report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
  body: JSON.stringify(reportData)
});
```

### Custom Report Types

**Comprehensive Report:**
- Full AI evaluation with all criteria
- All charts and visualizations
- Question-by-question analysis
- Complete learning recommendations

**Summary Report:**
- Basic performance metrics
- Key strengths and weaknesses
- Essential recommendations
- Reduced chart set

**Analytics Report (Teachers Only):**
- Session analytics integration
- Behavioral assessment
- Risk indicators
- Proctoring insights

## Future Enhancements

### Planned Features

1. **Interactive Dashboard Integration:** Real-time preview before PDF generation
2. **Custom Branding:** Institution logos and color schemes
3. **Multi-Language Support:** Internationalization for global use
4. **Advanced Analytics:** Machine learning-powered insights
5. **Batch Processing:** Multiple student reports simultaneously
6. **Email Integration:** Automatic report distribution
7. **Mobile Optimization:** Responsive design for mobile viewing

### Technical Improvements

1. **Caching System:** Redis-based caching for repeated AI evaluations
2. **Background Processing:** Asynchronous report generation with job queues
3. **CDN Integration:** Chart and asset optimization
4. **Database Optimization:** Report metadata storage
5. **API Rate Limiting:** OpenAI API usage optimization
6. **Error Monitoring:** Comprehensive logging and alerting

## Troubleshooting

### Common Issues

**1. PDF Layout Problems:**
- Check CSS grid compatibility with WeasyPrint
- Verify page margins and container widths
- Test with different content lengths

**2. Chart Rendering Failures:**
- Ensure matplotlib backend is set to 'Agg'
- Check memory availability for chart generation
- Verify data format consistency

**3. AI API Timeouts:**
- Implement retry logic with exponential backoff
- Monitor OpenAI API status and rate limits
- Use fallback evaluation system

**4. Font Rendering Issues:**
- Specify web-safe font fallbacks
- Test font availability across environments
- Consider font embedding for consistency

### Debug Mode

**Enable Detailed Logging:**
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

**Chart Debug:**
```python
# Save charts to disk for inspection
plt.savefig(f'/tmp/debug_chart_{chart_name}.png')
```

**Template Debug:**
```python
# Save rendered HTML before PDF conversion
with open('/tmp/debug_report.html', 'w') as f:
    f.write(html_content)
```

## Conclusion

The SENSAI Report Generation System provides a comprehensive, AI-powered solution for exam performance analysis. With structured evaluations, interactive visualizations, and professional PDF output, it serves both educational assessment and student improvement goals. The system is designed for scalability, reliability, and extensibility, making it suitable for educational institutions of all sizes.