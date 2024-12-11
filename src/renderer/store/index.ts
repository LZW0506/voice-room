import { configureStore } from '@reduxjs/toolkit'
import systemSlice from '@renderer/store/modules/systemSlice'

const store = configureStore({
  reducer: {
    systemSlice
  }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store
