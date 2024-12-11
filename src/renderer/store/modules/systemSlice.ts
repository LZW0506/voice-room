import { createSlice } from '@reduxjs/toolkit'
// Define a type for the slice state
interface CounterState {
  lang: string
}

// Define the initial state using that type
const initialState: CounterState = {
  lang: 'zh-CN'
}

const systemSlice = createSlice({
  name: 'system',
  initialState,
  reducers: {
    changeLang(state, action) {
      state.lang = action.payload
    }
  }
})

export const { changeLang } = systemSlice.actions
export default systemSlice.reducer
