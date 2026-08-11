import { useQuery } from '@tanstack/react-query'
import { getView, getLayers, getCountdown } from '../api/client'
import type { ViewMode, MonthData, YearData } from '../types'

export function useViewData(mode: ViewMode, anchor: string) {
  return useQuery<MonthData | YearData>({
    queryKey: ['view', mode, anchor],
    queryFn: () => getView(mode, anchor),
    staleTime: 60_000,
  })
}

export function useLayers() {
  return useQuery({
    queryKey: ['layers'],
    queryFn: getLayers,
    staleTime: 60_000,
  })
}

export function useCountdown() {
  return useQuery({
    queryKey: ['countdown'],
    queryFn: getCountdown,
    staleTime: 60_000,
  })
}
