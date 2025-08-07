#!/usr/bin/env python3
"""
Migration script to add role-based features to exam system
This script adds missing columns to existing tables for the role-based exam system
"""

import asyncio
import aiosqlite
from api.config import exams_table_name, exam_events_table_name
from api.utils.db import get_new_db_connection

async def migrate_database():
    """Add new columns to existing tables for role-based features"""
    
    print("🚀 Starting database migration for role-based exam system...")
    
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Add role column to exams table if it doesn't exist
            print("📝 Adding role column to exams table...")
            try:
                await cursor.execute(f"""
                    ALTER TABLE {exams_table_name} 
                    ADD COLUMN role TEXT DEFAULT 'teacher'
                """)
                print("✅ Added role column to exams table")
            except Exception as e:
                if "duplicate column name" in str(e).lower():
                    print("ℹ️ Role column already exists in exams table")
                else:
                    print(f"❌ Error adding role column: {e}")

            # Add priority column to exam_events table
            print("📝 Adding priority column to exam_events table...")
            try:
                await cursor.execute(f"""
                    ALTER TABLE {exam_events_table_name} 
                    ADD COLUMN priority INTEGER DEFAULT 1
                """)
                print("✅ Added priority column to exam_events table")
            except Exception as e:
                if "duplicate column name" in str(e).lower():
                    print("ℹ️ Priority column already exists in exam_events table")
                else:
                    print(f"❌ Error adding priority column: {e}")

            # Add confidence_score column to exam_events table
            print("📝 Adding confidence_score column to exam_events table...")
            try:
                await cursor.execute(f"""
                    ALTER TABLE {exam_events_table_name} 
                    ADD COLUMN confidence_score REAL DEFAULT 0.0
                """)
                print("✅ Added confidence_score column to exam_events table")
            except Exception as e:
                if "duplicate column name" in str(e).lower():
                    print("ℹ️ Confidence_score column already exists in exam_events table")
                else:
                    print(f"❌ Error adding confidence_score column: {e}")

            # Add is_flagged column to exam_events table
            print("📝 Adding is_flagged column to exam_events table...")
            try:
                await cursor.execute(f"""
                    ALTER TABLE {exam_events_table_name} 
                    ADD COLUMN is_flagged BOOLEAN DEFAULT FALSE
                """)
                print("✅ Added is_flagged column to exam_events table")
            except Exception as e:
                if "duplicate column name" in str(e).lower():
                    print("ℹ️ Is_flagged column already exists in exam_events table")
                else:
                    print(f"❌ Error adding is_flagged column: {e}")

            # Create indexes for the new columns
            print("📝 Creating indexes for new columns...")
            
            try:
                await cursor.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_exam_role ON {exams_table_name} (role)
                """)
                print("✅ Created index for role column")
            except Exception as e:
                print(f"❌ Error creating role index: {e}")

            try:
                await cursor.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_exam_event_flagged ON {exam_events_table_name} (is_flagged)
                """)
                print("✅ Created index for is_flagged column")
            except Exception as e:
                print(f"❌ Error creating is_flagged index: {e}")

            try:
                await cursor.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_exam_event_priority ON {exam_events_table_name} (priority)
                """)
                print("✅ Created index for priority column")
            except Exception as e:
                print(f"❌ Error creating priority index: {e}")
            
            await conn.commit()
            print("✅ Database migration completed successfully!")
            
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        raise

if __name__ == "__main__":
    print("🎯 Running exam system database migration...")
    asyncio.run(migrate_database())
    print("🎉 Migration completed!")
