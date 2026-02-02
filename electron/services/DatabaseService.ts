import { ipcMain } from 'electron'
import { firestoreListDocuments, supabaseSelect, type FirestoreListDocumentsOptions, type SupabaseSelectOptions } from '../database'

export class DatabaseService {
    private static instance: DatabaseService

    private constructor() { }

    static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService()
        }
        return DatabaseService.instance
    }

    registerIpcHandlers(): void {
        ipcMain.handle('db:supabase:select', async (_event, options: SupabaseSelectOptions) => {
            try {
                const { rows } = await supabaseSelect(options)
                return { success: true, rows }
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : 'Supabase query failed' }
            }
        })

        ipcMain.handle('db:firestore:listDocuments', async (_event, options: FirestoreListDocumentsOptions) => {
            try {
                const { documents, nextPageToken } = await firestoreListDocuments(options)
                return { success: true, documents, nextPageToken }
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : 'Firestore query failed' }
            }
        })
    }
}
